/**
 * tests/teardown.ts
 *
 * Jest globalTeardown – runs once after the entire test suite.
 * Drops the test database to keep the environment clean.
 */

import { Pool } from "pg";

const ADMIN_DB_URL =
  process.env.ADMIN_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/postgres";

export default async function globalTeardown(): Promise<void> {
  console.log("[teardown] Dropping test database...");

  const adminPool = new Pool({ connectionString: ADMIN_DB_URL });
  try {
    // Terminate any remaining connections before dropping
    await adminPool.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = 'vesting_test' AND pid <> pg_backend_pid()
    `);
    await adminPool.query(`DROP DATABASE IF EXISTS vesting_test`);
    console.log("[teardown] Test database dropped.");
  } finally {
    await adminPool.end();
  }
}
