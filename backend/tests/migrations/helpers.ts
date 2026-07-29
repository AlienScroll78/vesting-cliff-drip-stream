/**
 * tests/migrations/helpers.ts
 *
 * Shared helpers for migration tests.
 * Each test gets a fresh pool connection, runs up/down migrations,
 * and verifies schema state.
 */

import { Pool, PoolClient } from "pg";
import { execSync } from "child_process";
import * as path from "path";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/vesting_test";

const PROJECT_ROOT = path.resolve(__dirname, "../..");

/**
 * Creates a new pool connected to the test database.
 * The caller is responsible for calling pool.end() after tests.
 */
export function createTestPool(): Pool {
  return new Pool({ connectionString: TEST_DB_URL, max: 3 });
}

/**
 * Applies all pending migrations (node-pg-migrate up).
 */
export function migrateUp(): void {
  execSync("npx node-pg-migrate up --migration-file-language ts", {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, NODE_ENV: "test" },
    stdio: "inherit",
  });
}

/**
 * Rolls back the last applied migration (node-pg-migrate down).
 */
export function migrateDown(count = 1): void {
  execSync(
    `npx node-pg-migrate down --count ${count} --migration-file-language ts`,
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: TEST_DB_URL, NODE_ENV: "test" },
      stdio: "inherit",
    }
  );
}

/**
 * Rolls back ALL applied migrations (full teardown).
 */
export function migrateDownAll(): void {
  execSync("npx node-pg-migrate down --count 999 --migration-file-language ts", {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL, NODE_ENV: "test" },
    stdio: "inherit",
  });
}

/**
 * Returns the list of columns for a table.
 */
export async function columns(
  client: PoolClient,
  tableName: string
): Promise<Array<{ column_name: string; data_type: string; is_nullable: string }>> {
  const res = await client.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return res.rows;
}

/**
 * Returns true if a table exists in the public schema.
 */
export async function tableExists(
  client: PoolClient,
  tableName: string
): Promise<boolean> {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     )`,
    [tableName]
  );
  return res.rows[0].exists as boolean;
}

/**
 * Returns index names for a table.
 */
export async function indexNames(
  client: PoolClient,
  tableName: string
): Promise<string[]> {
  const res = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = $1`,
    [tableName]
  );
  return res.rows.map((r: { indexname: string }) => r.indexname);
}

/**
 * Returns applied migration names from the pgmigrations tracking table.
 */
export async function appliedMigrations(client: PoolClient): Promise<string[]> {
  const exists = await tableExists(client, "pgmigrations");
  if (!exists) return [];
  const res = await client.query(
    `SELECT name FROM pgmigrations ORDER BY run_on`
  );
  return res.rows.map((r: { name: string }) => r.name);
}
