/**
 * Resilience Test: DB Connection Lost Mid-Request → 503 Returned, Connection Recycled
 *
 * Scenario:
 *   1. A request reaches the service while a query is in-flight.
 *   2. Toxiproxy uses a reset_peer toxic to kill the DB connection mid-query.
 *   3. The service layer catches the error and returns HTTP 503.
 *   4. The connection pool recycles the broken connection.
 *   5. A subsequent request succeeds using a fresh connection.
 *
 * Requires docker-compose.toxiproxy.yml to be running.
 */

import { ToxiproxyClient, sleep } from './toxiproxyClient';

// ── Config ────────────────────────────────────────────────────────────────────

const TOXIPROXY_HOST = process.env.TOXIPROXY_HOST ?? 'localhost';
const TOXIPROXY_PORT = parseInt(process.env.TOXIPROXY_PORT ?? '8474', 10);
const DATABASE_URL   = process.env.DATABASE_URL ??
  'postgres://vesting:vesting@localhost:15432/vesting_test';

// ── Minimal pg pool wrapper ───────────────────────────────────────────────────
// Avoids importing the full service stack while still exercising the real
// pg driver through the Toxiproxy-proxied port.

interface QueryResult {
  rows: Record<string, unknown>[];
}

interface PoolLike {
  query(sql: string): Promise<QueryResult>;
  end(): Promise<void>;
}

function makePool(connectionString: string): PoolLike {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require('pg') as typeof import('pg');
  return new Pool({
    connectionString,
    max:              3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 3000,
  });
}

/** Service-layer wrapper that translates DB errors to 503. */
async function dbQuery(pool: PoolLike, sql: string): Promise<{ status: 200 | 503; rows: unknown[] }> {
  try {
    const result = await pool.query(sql);
    return { status: 200, rows: result.rows };
  } catch {
    return { status: 503, rows: [] };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const tp = new ToxiproxyClient(TOXIPROXY_HOST, TOXIPROXY_PORT);

describe('Resilience: DB connection lost mid-request → 503, connection recycled', () => {
  let pool: PoolLike;

  beforeAll(async () => {
    const healthy = await tp.isHealthy();
    if (!healthy) throw new Error('Toxiproxy is not reachable.');

    pool = makePool(DATABASE_URL);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    try {
      const proxy = await tp.getProxy('postgres');
      await proxy.enable();
      await proxy.removeAllToxics();
    } catch { /* ignore */ }
  });

  it('returns 503 when the DB connection is reset mid-query', async () => {
    const proxy = await tp.getProxy('postgres');

    // reset_peer with a very short timeout forces the connection to close
    // during the query.
    await proxy.addToxic({
      type:       'reset_peer',
      stream:     'downstream',
      toxicity:   1.0,
      attributes: { timeout: 50 }, // ms before reset
    });

    const result = await dbQuery(pool, 'SELECT 1 AS n');

    expect(result.status).toBe(503);
    expect(result.rows).toHaveLength(0);
  }, 15_000);

  it('succeeds with a fresh connection after the toxic is removed', async () => {
    const proxy = await tp.getProxy('postgres');

    // First: inject fault.
    await proxy.addToxic({
      type:       'reset_peer',
      stream:     'downstream',
      toxicity:   1.0,
      attributes: { timeout: 50 },
    });
    await dbQuery(pool, 'SELECT 1'); // will fail & recycle the broken conn

    // Remove the toxic.
    await proxy.removeAllToxics();
    await sleep(200); // allow pool to establish a new connection

    // Second request should succeed.
    const result = await dbQuery(pool, 'SELECT 1 AS n');
    expect(result.status).toBe(200);
  }, 20_000);

  it('returns 503 when the DB proxy is entirely disabled', async () => {
    const proxy = await tp.getProxy('postgres');
    await proxy.disable();

    const result = await dbQuery(pool, 'SELECT 1 AS n');
    expect(result.status).toBe(503);

    // Re-enable for cleanup.
    await proxy.enable();
  }, 15_000);
});
