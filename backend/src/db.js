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

/**
 * Shared PostgreSQL connection pool (CommonJS entry point).
 * Requires DATABASE_URL in the environment.
 *
 * Pool configuration (Issue #741):
 *   - min: 5 connections kept warm at all times
 *   - max: 20 connections — stays within RDS t3.micro limit of 100
 *   - idleTimeoutMillis: 300 000 ms (5 min) — evict idle connections
 *   - connectionTimeoutMillis: 5 000 ms — fail fast on pool exhaustion
 *   - statement_timeout: 5 000 ms — prevent runaway queries
 */

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for database access');
}

const pool = new Pool({
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
pool.on("error", (err) => {
  console.error("[db] Idle client error:", err.message);
});

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
