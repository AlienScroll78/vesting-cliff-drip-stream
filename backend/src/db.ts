/**
 * Shared PostgreSQL connection pool.
 * Requires DATABASE_URL in the environment.
 */
import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
