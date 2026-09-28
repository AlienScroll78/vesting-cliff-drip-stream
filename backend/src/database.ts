/**
 * src/database.ts
 *
 * PostgreSQL connection helper used by migration tests and the application.
 * The test database URL is configured via TEST_DATABASE_URL environment variable.
 */

import { Pool, PoolClient, QueryResult } from "pg";

export function createPool(connectionString?: string): Pool {
  return new Pool({
    connectionString:
      connectionString ||
      process.env.TEST_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/vesting_test",
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Returns all column metadata for a given table in the public schema.
 */
export async function getTableColumns(
  client: PoolClient,
  tableName: string
): Promise<Array<{ column_name: string; data_type: string; is_nullable: string }>> {
  const result = await client.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return result.rows;
}

/**
 * Returns all index names for a given table.
 */
export async function getTableIndexes(
  client: PoolClient,
  tableName: string
): Promise<string[]> {
  const result = await client.query(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = $1`,
    [tableName]
  );
  return result.rows.map((r: { indexname: string }) => r.indexname);
}

/**
 * Returns true if the given table exists in the public schema.
 */
export async function tableExists(
  client: PoolClient,
  tableName: string
): Promise<boolean> {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     )`,
    [tableName]
  );
  return result.rows[0].exists as boolean;
}

/**
 * Returns the current schema_version / migration version tracked by
 * node-pg-migrate (stored in the `pgmigrations` table).
 */
export async function getAppliedMigrations(
  client: PoolClient
): Promise<string[]> {
  const exists = await tableExists(client, "pgmigrations");
  if (!exists) return [];

  const result = await client.query(
    `SELECT name FROM pgmigrations ORDER BY run_on`
  );
  return result.rows.map((r: { name: string }) => r.name);
}
