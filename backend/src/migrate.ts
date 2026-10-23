/**
 * src/migrate.ts
 *
 * Startup database migration runner (Issue #1013).
 *
 * The application must not begin accepting traffic until the schema is up to
 * date, otherwise a deploy can serve requests against a half-migrated database.
 * `runMigrations()` is therefore awaited during bootstrap, before the HTTP
 * server starts listening.
 *
 * Concurrency
 * -----------
 * In a multi-replica deployment (ECS, Kubernetes) every replica boots at once.
 * `node-pg-migrate` guards its runs with a PostgreSQL advisory lock
 * (`pg_try_advisory_lock`, lock id 7241865325823964). Because migrations are run
 * through a *single dedicated client* passed as `dbClient`, the lock and the
 * migrations execute on the same session — a pool would hand out different
 * connections and the lock would not protect anything.
 *
 * A replica that loses the race gets "Another migration is already running".
 * That is a normal, expected outcome rather than a fatal error, so it is
 * classified as `pending`: the winning replica is applying migrations right
 * now, and this replica may start once it observes a current schema.
 *
 * Status
 * ------
 * The result is cached in a module-level variable so `GET /health` can report
 * `db_migrations: "current" | "pending" | "failed"`.
 *
 * Dry run
 * -------
 * `MIGRATE_DRY_RUN=true` logs the migrations that would be applied without
 * applying them. `DB_MIGRATE_DRY_RUN` is accepted as a deprecated alias.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

/** Reported by `GET /health` as `db_migrations`. */
export type MigrationStatus = "current" | "pending" | "failed";

export interface MigrationResult {
  /** Whether the schema is up to date after this run. */
  status: MigrationStatus;
  /** Migration names applied during this invocation. */
  applied: string[];
  /** Migration names that were pending before this invocation. */
  pending: string[];
  /** Migration files the runner does not manage (the `V*.sql` track). */
  unmanaged: string[];
  /** True when `MIGRATE_DRY_RUN` was set; nothing was written. */
  dryRun: boolean;
  /** Populated only when `status === "failed"`. */
  error?: Error;
}

const migrationDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

/**
 * Advisory lock id used by `node-pg-migrate`. Kept here so the runner can
 * release the lock defensively if the migration run throws before doing so.
 */
const PG_MIGRATE_LOCK_ID = 7241865325823964;

/** Cached status for `/health`. Defaults to `pending` until a run completes. */
let _status: MigrationStatus = "pending";
let _lastResult: MigrationResult | null = null;

/** The status to report from `/health`. */
export function getMigrationStatus(): MigrationStatus {
  return _status;
}

/** The full result of the last run, or `null` if `runMigrations` has not run. */
export function getLastMigrationResult(): MigrationResult | null {
  return _lastResult;
}

/** Override the cached status. Exported for tests. */
export function setMigrationStatus(status: MigrationStatus): void {
  _status = status;
}

/** True when dry-run mode is requested. Prefers the issue-specified name. */
export function isDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MIGRATE_DRY_RUN === "true" || env.DB_MIGRATE_DRY_RUN === "true";
}

/**
 * Migration files on disk that this runner manages: the numbered `.ts` track
 * that `node-pg-migrate` applies and that `schema_migrations` records.
 */
export function listManagedMigrations(): string[] {
  return readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.slice(0, -3))
    .sort();
}

/**
 * Migration files present but not managed by `node-pg-migrate` here.
 *
 * The `V*__*.sql` files are a separate track. Applying them during startup
 * risks aborting a boot against a schema where they are already applied, so
 * they are reported for visibility instead of run. Surfacing them keeps schema
 * drift observable without making startup fragile.
 */
export function listUnmanagedMigrations(): string[] {
  return readdirSync(migrationDirectory)
    .filter((name) => !name.endsWith(".ts"))
    .sort();
}

/** Read the migration names already recorded in `schema_migrations`. */
async function readApplied(
  client: PoolClient,
  migrationsTable = "pgmigrations"
): Promise<Set<string>> {
  try {
    const { rows } = await client.query<{ name: string }>(
      `SELECT name FROM ${migrationsTable}`
    );
    return new Set(rows.map((row) => row.name));
  } catch (err) {
    // Undefined table means nothing has been applied yet — first boot.
    const code = (err as { code?: string }).code;
    if (code === "42P01") return new Set();
    throw err;
  }
}

/**
 * Determine the migrations that still need to run.
 *
 * `node-pg-migrate` exposes the pending list through its log callback rather
 * than its return value, so the caller passes the names it observes here.
 */
export function computePending(
  managed: string[],
  applied: Set<string>
): string[] {
  return managed.filter((name) => !applied.has(name));
}

/**
 * Run pending migrations against a single dedicated client.
 *
 * Awaited during bootstrap so the schema is current before the server accepts
 * traffic. Never throws: failures are captured and reported via
 * `getMigrationStatus()` so the caller can decide the exit code.
 */
export async function runMigrations(
  options: {
    client?: PoolClient;
    databaseUrl?: string;
    dryRun?: boolean;
    log?: (line: string) => void;
    migrationsTable?: string;
  } = {}
): Promise<MigrationResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const dryRun = options.dryRun ?? isDryRun();
  const migrationsTable = options.migrationsTable ?? "pgmigrations";

  const unmanaged = listUnmanagedMigrations();
  const managed = listManagedMigrations();

  let ownsClient = false;
  let client = options.client;
  let ownPool: { end: () => Promise<void> } | null = null;

  try {
    if (!client) {
      // `pg` is CommonJS: under ESM interop the constructor lives on `.default`.
      const pg = await import("pg");
      const Pool = (pg.default?.Pool ?? pg.Pool) as typeof import("pg").Pool;
      const pool = new Pool({
        connectionString: options.databaseUrl ?? process.env.DATABASE_URL,
        max: 1,
      });
      ownPool = pool;
      client = (await pool.connect()) as PoolClient;
      ownsClient = true;
    }

    const applied = await readApplied(client, migrationsTable);
    const pending = computePending(managed, applied);

    if (unmanaged.length > 0) {
      log(
        `[migrate] ${unmanaged.length} unmanaged migration file(s) present ` +
          `(${unmanaged.join(", ")}) — these are not applied at startup`
      );
    }

    if (pending.length === 0) {
      log("[migrate] schema is current; no pending migrations");
      const result: MigrationResult = {
        status: "current",
        applied: [],
        pending: [],
        unmanaged,
        dryRun,
      };
      _status = result.status;
      _lastResult = result;
      return result;
    }

    if (dryRun) {
      log(
        `[migrate] DRY RUN — would apply ${pending.length} migration(s): ` +
          `${pending.join(", ")} (nothing was written)`
      );
      const result: MigrationResult = {
        // Nothing was applied, so the schema is not current yet.
        status: "pending",
        applied: [],
        pending,
        unmanaged,
        dryRun,
      };
      _status = result.status;
      _lastResult = result;
      return result;
    }

    log(
      `[migrate] applying ${pending.length} pending migration(s): ${pending.join(", ")}`
    );

    // Imported dynamically: node-pg-migrate is ESM-only, and importing it
    // lazily keeps startup fast when there is nothing to do.
    const { runner } = await import("node-pg-migrate");

    const appliedNow: string[] = [];
    await runner({
      // A single dedicated client so the advisory lock and the migrations
      // share one session — this is what makes the lock effective.
      dbClient: client,
      dir: migrationDirectory,
      direction: "up",
      migrationsTable,
      // Leave `noLock` unset: node-pg-migrate must take the advisory lock.
      log: (msg: string) => {
        const match = /^### MIGRATION (\S+) \(UP\)/.exec(msg.trim());
        if (match) appliedNow.push(match[1]);
        else if (msg.trim()) log(`[migrate] ${msg.trim()}`);
      },
      logger: {
        debug: () => {},
        info: (msg: string) => log(`[migrate] ${msg}`),
        warn: (msg: string) => console.warn(`[migrate] ${msg}`),
        error: (msg: string) => console.error(`[migrate] ${msg}`),
      },
    });

    const result: MigrationResult = {
      status: "current",
      applied: appliedNow.length > 0 ? appliedNow : pending,
      pending: [],
      unmanaged,
      dryRun: false,
    };
    _status = result.status;
    _lastResult = result;
    log(`[migrate] schema is current (${pending.length} migration(s) applied)`);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // A replica that loses the advisory-lock race sees this. It is expected in
    // a multi-replica rollout, and the winner is mid-migration, so report
    // `pending` rather than `failed`.
    if (/another migration is already running/i.test(error.message)) {
      log(
        "[migrate] another replica holds the migration lock; " +
          "deferring to it (status: pending)"
      );
      const result: MigrationResult = {
        status: "pending",
        applied: [],
        pending: managed,
        unmanaged,
        dryRun,
      };
      _status = result.status;
      _lastResult = result;
      return result;
    }

    // Release the advisory lock defensively in case the run aborted after
    // acquiring it. A dropped connection releases it anyway; this covers the
    // case where the client is still alive.
    if (client) {
      await client
        .query(`SELECT pg_advisory_unlock(${PG_MIGRATE_LOCK_ID})`)
        .catch(() => {});
    }

    const result: MigrationResult = {
      status: "failed",
      applied: [],
      pending: managed,
      unmanaged,
      dryRun,
      error,
    };
    _status = result.status;
    _lastResult = result;
    console.error(`[migrate] migration failed: ${error.message}`);
    return result;
  } finally {
    if (ownsClient && client) {
      // Release first so the pool is not left holding the connection, then
      // close the pool itself so the process can exit.
      client.release();
      await ownPool?.end().catch(() => {});
    }
  }
}

/**
 * Bootstrap gate: run migrations and abort the process when the schema could
 * not be brought up to date.
 *
 * Exits non-zero with a descriptive message on failure, per issue #1013.
 */
export async function runMigrationsOrExit(
  options: Parameters<typeof runMigrations>[0] = {}
): Promise<void> {
  const result = await runMigrations(options);

  if (result.status === "failed") {
    console.error(
      "[migrate] Startup aborted: database migrations failed. " +
        `Reason: ${result.error?.message ?? "unknown error"}`
    );
    process.exit(1);
  }
}
