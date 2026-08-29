/**
 * Shared PostgreSQL connection pool.
 *
 * This module re-exports the pool from database.ts so that existing imports
 * of "../db.js" continue to work without change.
 *
 * The canonical implementation with Prometheus metrics lives in database.ts.
 */
export { pool } from "./database.js";
