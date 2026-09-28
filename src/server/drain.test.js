import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { AdminDrainManager } from './drain.js';
import { createApp } from './app.js';

describe('Admin Stream Expiry Drain Endpoint (Issue #301)', () => {
  const jwtSecret = 'test-secret-key';
  const adminToken = jwt.sign({ sub: 'admin1', role: 'admin' }, jwtSecret);
  const userToken = jwt.sign({ sub: 'user1', role: 'user' }, jwtSecret);

  test('requires admin JWT authorization', async () => {
    const drainManager = new AdminDrainManager({ jwtSecret });
    const app = createApp({ drainHandler: drainManager.getDrainHandler() });
    const server = app.listen(0);
    const port = server.address().port;

    try {
      // 1. Missing auth header -> 401
      const resNoAuth = await fetch(`http://127.0.0.1:${port}/api/v1/admin/drain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(resNoAuth.status, 401);

      // 2. Non-admin JWT -> 403
      const resUserAuth = await fetch(`http://127.0.0.1:${port}/api/v1/admin/drain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`
        },
        body: JSON.stringify({})
      });
      assert.equal(resUserAuth.status, 403);
    } finally {
      server.close();
    }
  });

  test('only processes expired streams (current_ledger > end_ledger + drain_delay_ledgers)', async () => {
    const streams = [
      { recipient: 'G...EXP1', end_ledger: 100 }, // 300 > 100 + 10 -> Expired
      { recipient: 'G...ACTIVE', end_ledger: 350 }, // 300 < 350 + 10 -> Not expired
    ];

    const drainManager = new AdminDrainManager({
      jwtSecret,
      streams,
      getCurrentLedger: () => 300,
      cooldownMs: 0
    });

    const app = createApp({ drainHandler: drainManager.getDrainHandler() });
    const server = app.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/admin/drain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ drain_delay_ledgers: 10 })
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.scanned, 2);
      assert.equal(json.eligible, 1);
      assert.equal(json.submitted, 1);
      assert.equal(json.streams[0].recipient, 'G...EXP1');
      assert.ok(json.streams[0].tx_hash);
    } finally {
      server.close();
    }
  });

  test('dry-run mode returns eligible streams without executing drain transactions', async () => {
    const streams = [
      { recipient: 'G...EXP1', end_ledger: 100 }
    ];

    const drainManager = new AdminDrainManager({
      jwtSecret,
      streams,
      getCurrentLedger: () => 300
    });

    const app = createApp({ drainHandler: drainManager.getDrainHandler() });
    const server = app.listen(0);
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/admin/drain?dry_run=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.dry_run, true);
      assert.equal(json.eligible, 1);
      assert.equal(json.submitted, 0);
      assert.equal(json.streams[0].tx_hash, null);
    } finally {
      server.close();
    }
  });

  test('enforces rate limit of 1 execution per 5 minutes', async () => {
    const drainManager = new AdminDrainManager({
      jwtSecret,
      streams: [],
      cooldownMs: 300000
    });

    const app = createApp({ drainHandler: drainManager.getDrainHandler() });
    const server = app.listen(0);
    const port = server.address().port;

    try {
      // First execution succeeds
      const res1 = await fetch(`http://127.0.0.1:${port}/api/v1/admin/drain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      });
      assert.equal(res1.status, 200);

      // Immediate second execution returns 429
      const res2 = await fetch(`http://127.0.0.1:${port}/api/v1/admin/drain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      });
      assert.equal(res2.status, 429);
      const json2 = await res2.json();
      assert.match(json2.message, /Rate limit/i);
    } finally {
      server.close();
    }
  });
});
