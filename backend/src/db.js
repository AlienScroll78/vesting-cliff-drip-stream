/**
 * db.js — PostgreSQL connection pool with structured query logging.
 *
 * Every query is logged at debug level with the following fields so that
 * database activity can be correlated to the originating HTTP request:
 *   request_id     — propagated automatically via AsyncLocalStorage
 *   trace_id       — propagated automatically via AsyncLocalStorage
 *   correlation_id — propagated automatically via AsyncLocalStorage
 *   db.query       — normalised SQL text (parameters replaced by $N placeholders)
 *   db.duration_ms — round-trip time in milliseconds
 *
 * Usage (drop-in replacement for the bare Pool):
 *   import { pool, query } from './db.js';
 *   // Use pool directly for transactions, or use the helper:
 *   const result = await query('SELECT * FROM streams WHERE id = $1', [id]);
 */

import pg from 'pg';
import { logger } from './logger.js';

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
  const startNs = process.hrtime.bigint();
  try {
    const result = await pool.query(text, values);
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;

    logger.debug(
      {
        event:            'db_query',
        'db.system':      'postgresql',
        'db.query':       text,
        'db.row_count':   result.rowCount,
        'db.duration_ms': Math.round(durationMs * 100) / 100,
      },
      'db query',
    );

    return result;
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;

    logger.error(
      {
        event:            'db_query_error',
        'db.system':      'postgresql',
        'db.query':       text,
        'db.duration_ms': Math.round(durationMs * 100) / 100,
        err,
      },
      'db query failed',
    );

    throw err;
  }
}
