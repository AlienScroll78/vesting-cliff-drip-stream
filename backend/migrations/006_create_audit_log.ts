/**
 * migrations/006_create_audit_log.ts
 *
 * Creates the immutable `audit_log` table that records every admin action.
 *
 * Design decisions:
 *  - BIGSERIAL primary key for natural insertion ordering and fast range scans.
 *  - INET type for ip_address so PostgreSQL validates the format automatically.
 *  - UUID correlation_id links audit entries to distributed-trace spans.
 *  - App DB user is granted INSERT only — no UPDATE or DELETE — enforcing
 *    append-only immutability at the database permission level.
 *  - Table comment documents the 7-year retention requirement for compliance.
 *
 * Retention policy:
 *  Log entries must be retained for 7 years (2555 days). This is enforced via
 *  RDS automated backup retention (set to 35 days with a manual snapshot policy
 *  in terraform/modules/data/main.tf) and a separate archival process that
 *  exports rows older than 1 year to S3 Glacier.
 *
 * Issue #755
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * The application DB role name. In production this is injected by ESO from
 * AWS Secrets Manager. Defaults to the conventional local dev role.
 */
const APP_ROLE = process.env.DB_APP_ROLE ?? "vesting_app";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ── Create table ──────────────────────────────────────────────────────────

  pgm.createTable("audit_log", {
    id: {
      type: "bigserial",
      primaryKey: true,
      notNull: true,
    },
    actor_address: {
      type: "text",
      notNull: true,
      comment: "Stellar public key (G…) or 'system' for automated actions",
    },
    action: {
      type: "text",
      notNull: true,
      comment:
        "Action identifier, e.g. set_min_deposit, pause_stream, backfill, set_allowlist",
    },
    parameters: {
      type: "jsonb",
      notNull: false,
      comment: "Structured input parameters passed to the action",
    },
    result: {
      type: "text",
      notNull: true,
      comment: "'success' or a human-readable error message",
    },
    ip_address: {
      type: "inet",
      notNull: false,
      comment: "Client IP address from X-Forwarded-For or socket.remoteAddress",
    },
    correlation_id: {
      type: "uuid",
      notNull: false,
      comment: "Distributed trace / request correlation ID",
    },
    performed_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
      comment: "Wall-clock timestamp when the action was recorded",
    },
  });

  // ── Indexes ───────────────────────────────────────────────────────────────

  // Most queries filter by actor or action, paginated by performed_at DESC.
  pgm.createIndex("audit_log", ["performed_at"], {
    name: "idx_audit_log_performed_at",
  });
  pgm.createIndex("audit_log", ["actor_address", "performed_at"], {
    name: "idx_audit_log_actor",
  });
  pgm.createIndex("audit_log", ["action", "performed_at"], {
    name: "idx_audit_log_action",
  });
  pgm.createIndex("audit_log", ["correlation_id"], {
    name: "idx_audit_log_correlation_id",
    where: "correlation_id IS NOT NULL",
  });

  // ── Table comment (retention policy) ─────────────────────────────────────

  pgm.sql(`
    COMMENT ON TABLE audit_log IS
      'Immutable audit trail for all admin actions. '
      'Rows must be retained for 7 years (2555 days) per compliance policy. '
      'App user has INSERT only — no UPDATE or DELETE. '
      'Issue #755.';
  `);

  // ── Column comments ───────────────────────────────────────────────────────

  pgm.sql(`COMMENT ON COLUMN audit_log.id IS 'Auto-incrementing surrogate key; also natural insertion order.';`);
  pgm.sql(`COMMENT ON COLUMN audit_log.actor_address IS 'Stellar public key of the admin who performed the action.';`);
  pgm.sql(`COMMENT ON COLUMN audit_log.action IS 'Machine-readable action name (snake_case).';`);
  pgm.sql(`COMMENT ON COLUMN audit_log.parameters IS 'Input parameters as JSONB — do not include secrets.';`);
  pgm.sql(`COMMENT ON COLUMN audit_log.result IS '''success'' or error message.';`);
  pgm.sql(`COMMENT ON COLUMN audit_log.ip_address IS 'Client IP — stored as INET for indexability.';`);
  pgm.sql(`COMMENT ON COLUMN audit_log.correlation_id IS 'Trace ID linking to distributed spans.';`);
  pgm.sql(`COMMENT ON COLUMN audit_log.performed_at IS 'Timestamp with time zone; defaults to now().';`);

  // ── Permissions: app user gets INSERT only ────────────────────────────────
  //
  // We wrap in DO $$ to swallow the error gracefully when the role does not
  // exist in local dev (e.g., plain `postgres` superuser only).

  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        GRANT INSERT ON TABLE audit_log TO ${APP_ROLE};
        GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO ${APP_ROLE};
        -- Explicitly revoke write ops in case they were inherited from schema privs
        REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_log FROM ${APP_ROLE};
      END IF;
    END
    $$;
  `);

  // SELECT is granted separately so the audit-log read endpoint works under
  // the same role. If a read-only replica role is used, grant it SELECT only.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        GRANT SELECT ON TABLE audit_log TO ${APP_ROLE};
      END IF;
    END
    $$;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Revoke permissions first to avoid dependency errors.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        REVOKE ALL ON TABLE audit_log FROM ${APP_ROLE};
        REVOKE ALL ON SEQUENCE audit_log_id_seq FROM ${APP_ROLE};
      END IF;
    END
    $$;
  `);

  pgm.dropTable("audit_log");
}
