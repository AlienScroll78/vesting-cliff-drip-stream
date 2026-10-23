//! Database query module — all SQL used by the integration tests lives here.
//!
//! Functions follow the same query patterns as the Node.js backend so that the
//! Rust tests exercise the *exact* SQL the backend depends on.
//!
//! # NUMERIC binding
//! `tokio-postgres` does not implement `ToSql` for `f64` against PostgreSQL
//! `NUMERIC` columns.  We use `rust_decimal::Decimal` (with the `tokio-pg`
//! feature) which maps directly to/from PostgreSQL `NUMERIC`.

use rust_decimal::Decimal;
use std::str::FromStr;
use tokio_postgres::Client;

// ── Types ────────────────────────────────────────────────────────────────────

/// Mirrors the `schedules` row (subset of columns used in tests).
#[derive(Debug, Clone)]
pub struct Schedule {
    pub id: i64,
    pub recipient: String,
    pub sponsor: String,
    pub token: String,
    pub rate_per_ledger: Decimal,
    pub start_ledger: i64,
    pub cliff_ledger: i64,
    pub end_ledger: i64,
    pub total_deposit: Decimal,
    pub status: String,
    pub version: i32,
}

/// Aggregate row returned by the sponsor analytics query.
#[derive(Debug, Clone)]
pub struct SponsorTokenStats {
    pub token: String,
    pub active_streams: i64,
    pub total_locked: Decimal,
    pub total_claimed: Decimal,
}

/// One page of schedules.
#[derive(Debug)]
pub struct SchedulePage {
    pub items: Vec<Schedule>,
    pub total: i64,
}

/// A row from `audit_log`.
#[derive(Debug, Clone)]
pub struct AuditEntry {
    pub id: i64,
    pub recipient: String,
    pub action: String,
    pub new_status: String,
}

// ── Migrations ───────────────────────────────────────────────────────────────

/// The ordered migration SQL files embedded at compile time.
const MIGRATIONS: &[(&str, &str)] = &[
    ("V1", include_str!("../../backend/migrations/V1__create_schedules.sql")),
    ("V2", include_str!("../../backend/migrations/V2__create_events.sql")),
    ("V3", include_str!("../../backend/migrations/V3__create_claims.sql")),
    ("V4", include_str!("../../backend/migrations/V4__add_version_and_audit_log.sql")),
];

/// Apply all migrations in order, tracking state in `schema_migrations`.
pub async fn run_migrations(client: &Client) -> Result<(), tokio_postgres::Error> {
    client
        .execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version    TEXT        PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
             )",
            &[],
        )
        .await?;

    for (version, sql) in MIGRATIONS {
        let already_applied: i64 = client
            .query_one(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = $1",
                &[version],
            )
            .await?
            .get(0);

        if already_applied == 0 {
            client.batch_execute(sql).await?;
            client
                .execute(
                    "INSERT INTO schema_migrations (version) VALUES ($1)",
                    &[version],
                )
                .await?;
        }
    }

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Parse a `&str` into `Decimal`, panicking with a clear message on failure.
pub fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap_or_else(|_| panic!("invalid Decimal literal: {s}"))
}

// ── Query functions ──────────────────────────────────────────────────────────

/// Insert a new `active` schedule row.
#[allow(clippy::too_many_arguments)]
pub async fn insert_schedule(
    client: &Client,
    recipient: &str,
    sponsor: &str,
    token: &str,
    rate_per_ledger: Decimal,
    start_ledger: i64,
    cliff_ledger: i64,
    end_ledger: i64,
    total_deposit: Decimal,
) -> Result<i64, tokio_postgres::Error> {
    let row = client
        .query_one(
            "INSERT INTO schedules
               (recipient, sponsor, token, rate_per_ledger, start_ledger, cliff_ledger,
                end_ledger, total_deposit, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
             RETURNING id",
            &[
                &recipient,
                &sponsor,
                &token,
                &rate_per_ledger,
                &start_ledger,
                &cliff_ledger,
                &end_ledger,
                &total_deposit,
            ],
        )
        .await?;

    Ok(row.get(0))
}

/// Select a schedule by recipient (the UNIQUE key).
pub async fn select_schedule_by_recipient(
    client: &Client,
    recipient: &str,
) -> Result<Option<Schedule>, tokio_postgres::Error> {
    let rows = client
        .query(
            "SELECT id, recipient, sponsor, token,
                    rate_per_ledger, start_ledger, cliff_ledger,
                    end_ledger, total_deposit, status, version
             FROM schedules
             WHERE recipient = $1",
            &[&recipient],
        )
        .await?;

    Ok(rows.first().map(|r| Schedule {
        id: r.get(0),
        recipient: r.get(1),
        sponsor: r.get(2),
        token: r.get(3),
        rate_per_ledger: r.get(4),
        start_ledger: r.get(5),
        cliff_ledger: r.get(6),
        end_ledger: r.get(7),
        total_deposit: r.get(8),
        status: r.get(9),
        version: r.get(10),
    }))
}

/// Paginated list of schedules for a sponsor.
pub async fn list_schedules_for_sponsor(
    client: &Client,
    sponsor: &str,
    page: i64,
    page_size: i64,
) -> Result<SchedulePage, tokio_postgres::Error> {
    let offset = (page - 1) * page_size;

    let total: i64 = client
        .query_one(
            "SELECT COUNT(*) FROM schedules WHERE sponsor = $1",
            &[&sponsor],
        )
        .await?
        .get(0);

    let rows = client
        .query(
            "SELECT id, recipient, sponsor, token,
                    rate_per_ledger, start_ledger, cliff_ledger,
                    end_ledger, total_deposit, status, version
             FROM schedules
             WHERE sponsor = $1
             ORDER BY id
             LIMIT $2 OFFSET $3",
            &[&sponsor, &page_size, &offset],
        )
        .await?;

    let items = rows
        .iter()
        .map(|r| Schedule {
            id: r.get(0),
            recipient: r.get(1),
            sponsor: r.get(2),
            token: r.get(3),
            rate_per_ledger: r.get(4),
            start_ledger: r.get(5),
            cliff_ledger: r.get(6),
            end_ledger: r.get(7),
            total_deposit: r.get(8),
            status: r.get(9),
            version: r.get(10),
        })
        .collect();

    Ok(SchedulePage { items, total })
}

/// Sponsor analytics aggregate — mirrors the SQL in analytics.ts.
pub async fn sponsor_analytics(
    client: &Client,
    sponsor: &str,
) -> Result<Vec<SponsorTokenStats>, tokio_postgres::Error> {
    let rows = client
        .query(
            "SELECT
                s.token,
                COUNT(*)::BIGINT                                     AS active_streams,
                COALESCE(SUM(s.total_deposit), 0)                    AS total_locked,
                COALESCE(SUM(c.claimed), 0)                          AS total_claimed
             FROM schedules s
             LEFT JOIN (
               SELECT token, recipient, SUM(amount) AS claimed
               FROM claims
               GROUP BY token, recipient
             ) c ON c.recipient = s.recipient AND c.token = s.token
             WHERE s.sponsor = $1 AND s.status = 'active'
             GROUP BY s.token
             ORDER BY s.token",
            &[&sponsor],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|r| SponsorTokenStats {
            token: r.get(0),
            active_streams: r.get(1),
            total_locked: r.get(2),
            total_claimed: r.get(3),
        })
        .collect())
}

/// Optimistic-lock status transition.
/// Returns `true` when the row was updated (version matched),
/// `false` when the version was stale.
pub async fn update_schedule_status(
    client: &Client,
    recipient: &str,
    new_status: &str,
    expected_version: i32,
) -> Result<bool, tokio_postgres::Error> {
    let rows_affected = client
        .execute(
            "UPDATE schedules
             SET status = $1, version = version + 1, updated_at = NOW()
             WHERE recipient = $2 AND version = $3",
            &[&new_status, &recipient, &expected_version],
        )
        .await?;

    Ok(rows_affected == 1)
}

/// Insert a row into `audit_log`.
pub async fn insert_audit_entry(
    client: &Client,
    recipient: &str,
    action: &str,
    old_status: Option<&str>,
    new_status: &str,
    ledger: Option<i64>,
    tx_hash: Option<&str>,
) -> Result<i64, tokio_postgres::Error> {
    let row = client
        .query_one(
            "INSERT INTO audit_log (recipient, action, old_status, new_status, ledger, tx_hash)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id",
            &[
                &recipient,
                &action,
                &old_status,
                &new_status,
                &ledger,
                &tx_hash,
            ],
        )
        .await?;

    Ok(row.get(0))
}

/// Fetch all audit entries for a recipient ordered by id.
pub async fn get_audit_entries(
    client: &Client,
    recipient: &str,
) -> Result<Vec<AuditEntry>, tokio_postgres::Error> {
    let rows = client
        .query(
            "SELECT id, recipient, action, new_status
             FROM audit_log
             WHERE recipient = $1
             ORDER BY id",
            &[&recipient],
        )
        .await?;

    Ok(rows
        .iter()
        .map(|r| AuditEntry {
            id: r.get(0),
            recipient: r.get(1),
            action: r.get(2),
            new_status: r.get(3),
        })
        .collect())
}
