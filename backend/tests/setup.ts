/**
 * tests/setup.ts
 *
 * Jest globalSetup – runs once before the entire test suite.
 * Creates a fresh test database and applies all migrations.
 * Requires a running PostgreSQL instance (see CI config for Docker setup).
 */

import { Pool } from "pg";
import * as path from "path";
import { execSync } from "child_process";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/vesting_test";

const ADMIN_DB_URL =
  process.env.ADMIN_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/postgres";

export default async function globalSetup(): Promise<void> {
  console.log("[setup] Creating fresh test database...");

  // Connect to the default postgres DB to create/drop the test DB
  const adminPool = new Pool({ connectionString: ADMIN_DB_URL });

  try {
    // Drop existing test database if present, then recreate clean
    await adminPool.query(`DROP DATABASE IF EXISTS vesting_test`);
    await adminPool.query(`CREATE DATABASE vesting_test`);
    console.log("[setup] Test database created.");
  } finally {
    await adminPool.end();
  }

  // Run all migrations against the fresh test database
  console.log("[setup] Applying migrations...");
  try {
    execSync("npx node-pg-migrate up --migration-file-language ts", {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB_URL,
        NODE_ENV: "test",
      },
      stdio: "inherit",
    });
    console.log("[setup] All migrations applied successfully.");
  } catch (err) {
    console.error("[setup] Migration failed:", err);
    throw err;
  }
}
