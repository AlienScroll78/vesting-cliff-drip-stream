/**
 * db.js — PostgreSQL connection pool with structured query logging.
 *
 * Every query is logged at info level with the following fields so that
 * database activity can be correlated to the originating HTTP request:
 *   request_id     — propagated automatically via AsyncLocalStorage
 *   trace_id       — propagated automatically via AsyncLocalStorage
 *   correlation_id — propagated automatically via AsyncLocalStorage
 *   query_hash     — SHA-256 hash of normalized SQL text (no parameter values)
 *   rows_affected  — number of rows returned or changed
 *   duration_ms    — round-trip time in milliseconds
 *
 * Usage (drop-in replacement for the bare Pool):
 *   import { pool, query } from './db.js';
 *   // Use pool directly for transactions, or use the helper:
 *   const result = await query('SELECT * FROM streams WHERE id = $1', [id]);
 */

import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for database access');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Execute a parameterised query and emit a structured debug log line.
 * Errors are logged at error level and re-thrown to the caller.
 *
 * @param {string}  text    — SQL string with $N placeholders
 * @param {any[]}  [values] — bound parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(text, values) {
  return pool.query(text, values);
}
