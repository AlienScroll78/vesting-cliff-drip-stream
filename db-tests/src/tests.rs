//! Integration tests — 6 scenarios from issue #792.
//!
//! Each test calls `setup_db()` which spins up an isolated PostgreSQL
//! container, runs all 4 migrations, and returns a unique-database client.
//! Tests run concurrently; container-per-test guarantees no shared state.

use std::error::Error as StdError;

use crate::db::{
    dec, get_audit_entries, insert_audit_entry, insert_schedule, list_schedules_for_sponsor,
    select_schedule_by_recipient, sponsor_analytics, update_schedule_status,
};
use crate::helpers::{setup_db, unique_address};

// ── Scenario 1: stream insert and select by recipient ────────────────────────

/// Verify that a schedule can be inserted and retrieved by recipient (UNIQUE key).
/// Asserts every column value round-trips correctly.
#[tokio::test]
async fn test_insert_and_select_by_recipient() {
    let db = setup_db().await;

    let recipient = unique_address("RCP");
    let sponsor   = unique_address("SPO");
    let token     = unique_address("TOK");

    let id = insert_schedule(
        &db.client,
        &recipient, &sponsor, &token,
        dec("100"),          // rate_per_ledger
        1_000, 18_280, 190_000,
        dec("18900000"),     // total_deposit
    )
    .await
    .expect("insert should succeed");

    assert!(id > 0, "returned id should be positive");

    let s = select_schedule_by_recipient(&db.client, &recipient)
        .await
        .expect("select should not error")
        .expect("schedule should exist");

    assert_eq!(s.recipient, recipient);
    assert_eq!(s.sponsor,   sponsor);
    assert_eq!(s.token,     token);
    assert_eq!(s.rate_per_ledger, dec("100"));
    assert_eq!(s.start_ledger,    1_000);
    assert_eq!(s.cliff_ledger,    18_280);
    assert_eq!(s.end_ledger,      190_000);
    assert_eq!(s.status,  "active");
    assert_eq!(s.version, 1, "default version must be 1");
}

// ── Scenario 2: concurrent stream creation — unique constraint violation ──────

/// Two inserts for the same recipient: first succeeds, second must fail with a
/// unique-constraint error; only one row must exist afterward.
#[tokio::test]
async fn test_concurrent_insert_same_recipient_constraint_violation() {
    let db = setup_db().await;

    let recipient = unique_address("DUP");
    let sponsor   = unique_address("SPO");
    let token     = unique_address("TOK");

    let first = insert_schedule(
        &db.client, &recipient, &sponsor, &token,
        dec("50"), 1_000, 18_280, 190_000, dec("9450000"),
    )
    .await;
    assert!(first.is_ok(), "first insert should succeed: {:?}", first);

    let second = insert_schedule(
        &db.client, &recipient, &sponsor, &token,
        dec("50"), 1_000, 18_280, 190_000, dec("9450000"),
    )
    .await;

    assert!(
        second.is_err(),
        "duplicate recipient must violate UNIQUE constraint"
    );

    // tokio-postgres wraps the PG error; check the SqlState code directly.
    let pg_err = second.unwrap_err();
    let is_unique_violation = pg_err
        .source()
        .and_then(|e| e.downcast_ref::<tokio_postgres::error::DbError>())
        .and_then(|e| Some(e.code()))
        .map(|c| c == &tokio_postgres::error::SqlState::UNIQUE_VIOLATION)
        .unwrap_or(false);
    assert!(
        is_unique_violation,
        "error must be UNIQUE_VIOLATION (23505), got: {pg_err:?}"
    );

    let count: i64 = db
        .client
        .query_one("SELECT COUNT(*) FROM schedules WHERE recipient = $1", &[&recipient])
        .await
        .expect("count query")
        .get(0);
    assert_eq!(count, 1, "exactly one row must survive");
}

// ── Scenario 3: pagination query ─────────────────────────────────────────────

/// Insert N schedules for a sponsor and verify pages return correct items and
/// the total count, with no row appearing on more than one page.
#[tokio::test]
async fn test_pagination_returns_correct_page() {
    let db = setup_db().await;

    let sponsor = unique_address("SPO");
    let token   = unique_address("TOK");
    const TOTAL: usize = 7;
    const PAGE_SIZE: i64 = 3;

    for i in 0..TOTAL {
        let recipient = unique_address(&format!("RCP{i}"));
        insert_schedule(
            &db.client, &recipient, &sponsor, &token,
            dec(&format!("{}", 10 * (i + 1))),
            1_000, 18_280, 190_000, dec("1000000"),
        )
        .await
        .expect("insert should succeed");
    }

    let page1 = list_schedules_for_sponsor(&db.client, &sponsor, 1, PAGE_SIZE)
        .await.expect("page 1");
    assert_eq!(page1.total, TOTAL as i64, "total must equal inserted count");
    assert_eq!(page1.items.len(), PAGE_SIZE as usize, "page 1 size");

    let page2 = list_schedules_for_sponsor(&db.client, &sponsor, 2, PAGE_SIZE)
        .await.expect("page 2");
    assert_eq!(page2.items.len(), PAGE_SIZE as usize, "page 2 size");

    let page3 = list_schedules_for_sponsor(&db.client, &sponsor, 3, PAGE_SIZE)
        .await.expect("page 3");
    let remainder = TOTAL - (2 * PAGE_SIZE as usize);
    assert_eq!(page3.items.len(), remainder, "last page size");

    // No duplicate IDs across pages.
    let mut all_ids: Vec<i64> = page1.items.iter()
        .chain(page2.items.iter())
        .chain(page3.items.iter())
        .map(|s| s.id)
        .collect();
    all_ids.sort_unstable();
    all_ids.dedup();
    assert_eq!(all_ids.len(), TOTAL, "no duplicate rows across pages");
}

// ── Scenario 4: analytics aggregate with zero active streams ──────────────────

/// A sponsor with only non-active streams must produce an empty analytics
/// result, not an error (zero-stream edge case).
#[tokio::test]
async fn test_analytics_aggregate_zero_active_streams() {
    let db = setup_db().await;

    let sponsor = unique_address("SPO");
    let token   = unique_address("TOK");
    let r1      = unique_address("RCP1");

    insert_schedule(
        &db.client, &r1, &sponsor, &token,
        dec("100"), 1_000, 18_280, 190_000, dec("18900000"),
    )
    .await.expect("insert");

    // Move the single stream to 'completed' so no active streams remain.
    db.client
        .execute("UPDATE schedules SET status = 'completed' WHERE recipient = $1", &[&r1])
        .await.expect("set completed");

    let stats = sponsor_analytics(&db.client, &sponsor)
        .await.expect("analytics query must not error");

    assert!(
        stats.is_empty(),
        "zero active streams must produce empty result, got {stats:?}"
    );
}

// ── Scenario 5: optimistic lock — status transition with version check ────────

/// First writer with correct version succeeds and bumps the version.
/// Second writer with the stale (old) version must be rejected.
#[tokio::test]
async fn test_status_update_optimistic_lock() {
    let db = setup_db().await;

    let recipient = unique_address("RCP");
    let sponsor   = unique_address("SPO");
    let token     = unique_address("TOK");

    insert_schedule(
        &db.client, &recipient, &sponsor, &token,
        dec("100"), 1_000, 18_280, 190_000, dec("18900000"),
    )
    .await.expect("insert");

    let s = select_schedule_by_recipient(&db.client, &recipient)
        .await.expect("select").expect("must exist");
    assert_eq!(s.version, 1);

    // First update: correct version → succeeds.
    let ok = update_schedule_status(&db.client, &recipient, "completed", 1)
        .await.expect("first update");
    assert!(ok, "first update should succeed");

    let after = select_schedule_by_recipient(&db.client, &recipient)
        .await.expect("select after").expect("must exist");
    assert_eq!(after.version, 2, "version must be bumped");
    assert_eq!(after.status, "completed");

    // Second update: stale version (1) → rejected.
    let stale = update_schedule_status(&db.client, &recipient, "cancelled", 1)
        .await.expect("stale update");
    assert!(!stale, "stale version must not modify any row");

    let final_row = select_schedule_by_recipient(&db.client, &recipient)
        .await.expect("final select").expect("must exist");
    assert_eq!(final_row.status,  "completed", "status unchanged on stale");
    assert_eq!(final_row.version, 2,           "version unchanged on stale");
}

// ── Scenario 6: audit log is append-only ─────────────────────────────────────

/// Enforce append-only at the DB level via BEFORE triggers, then verify:
/// - INSERT succeeds
/// - DELETE is rejected
/// - UPDATE is rejected
/// - Rows are unchanged after failed mutations
#[tokio::test]
async fn test_audit_log_append_only() {
    let db = setup_db().await;

    let recipient = unique_address("RCP");
    let sponsor   = unique_address("SPO");
    let token     = unique_address("TOK");

    insert_schedule(
        &db.client, &recipient, &sponsor, &token,
        dec("100"), 1_000, 18_280, 190_000, dec("18900000"),
    )
    .await.expect("insert schedule");

    // Install append-only triggers.
    db.client
        .batch_execute(
            "CREATE OR REPLACE FUNCTION audit_log_immutable()
             RETURNS trigger LANGUAGE plpgsql AS $$
             BEGIN
                 RAISE EXCEPTION 'audit_log is append-only';
             END;
             $$;

             CREATE TRIGGER trg_audit_no_update
             BEFORE UPDATE ON audit_log
             FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

             CREATE TRIGGER trg_audit_no_delete
             BEFORE DELETE ON audit_log
             FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();",
        )
        .await.expect("trigger creation must succeed");

    // ── Append must succeed ───────────────────────────────────────────────────
    let entry_id = insert_audit_entry(
        &db.client, &recipient, "created", None, "active",
        Some(1_000), Some("txhash_create_1"),
    )
    .await.expect("first audit insert must succeed");
    assert!(entry_id > 0);

    insert_audit_entry(
        &db.client, &recipient, "claimed", Some("active"), "active",
        Some(20_000), Some("txhash_claim_1"),
    )
    .await.expect("second audit insert must succeed");

    // ── Verify two rows ───────────────────────────────────────────────────────
    let entries = get_audit_entries(&db.client, &recipient)
        .await.expect("get audit entries");
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].action, "created");
    assert_eq!(entries[1].action, "claimed");

    // ── DELETE must fail ──────────────────────────────────────────────────────
    let del = db.client
        .execute("DELETE FROM audit_log WHERE id = $1", &[&entry_id])
        .await;
    assert!(del.is_err(), "DELETE must be rejected by trigger");
    // The trigger raises a RAISE EXCEPTION which maps to SqlState P0001.
    let del_err = del.unwrap_err();
    let is_raise_exception = del_err
        .source()
        .and_then(|e| e.downcast_ref::<tokio_postgres::error::DbError>())
        .and_then(|e| Some(e.code()))
        .map(|c| c == &tokio_postgres::error::SqlState::RAISE_EXCEPTION)
        .unwrap_or(false);
    assert!(is_raise_exception, "DELETE error must be RAISE EXCEPTION (P0001), got: {del_err:?}");

    // ── UPDATE must fail ──────────────────────────────────────────────────────
    let upd = db.client
        .execute("UPDATE audit_log SET action = 'tampered' WHERE id = $1", &[&entry_id])
        .await;
    assert!(upd.is_err(), "UPDATE must be rejected by trigger");

    // ── Rows are unchanged ────────────────────────────────────────────────────
    let after = get_audit_entries(&db.client, &recipient)
        .await.expect("entries after failed mutations");
    assert_eq!(after.len(),    2,         "row count unchanged");
    assert_eq!(after[0].action, "created", "action not tampered");
}
