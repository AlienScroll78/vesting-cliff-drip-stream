/**
 * Shared PostgreSQL connection pool.
 * Requires DATABASE_URL in the environment.
 *
 * Pool configuration (Issue #741):
 *   - min: 5 connections kept warm at all times
 *   - max: 20 connections — stays well within RDS t3.micro limit of 100
 *   - idleTimeoutMillis: 300 000 ms (5 min) — evict idle connections
 *   - connectionTimeoutMillis: 5 000 ms — fail fast on pool exhaustion
 *   - statement_timeout: 5 000 ms — prevent runaway queries
 */
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for database access");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Connection count bounds
  min: 5,
  max: 20,
  // Evict connections idle longer than 5 minutes
  idleTimeoutMillis: 300_000,
  // Wait at most 5 s for a connection from the pool before throwing
  connectionTimeoutMillis: 5_000,
  // Per-connection session configuration — kills any query running > 5 s
  options: "-c statement_timeout=5000",
});

// Surface pool errors so they don't silently crash the process
pool.on("error", (err: Error) => {
  console.error("[db] Idle client error:", err.message);
});
