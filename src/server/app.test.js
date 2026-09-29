import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

describe('OpenAPI Spec Validation and Docs (Issue #298)', () => {
  const app = createApp();

  test('GET /api/openapi.json returns raw OpenAPI spec JSON', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/openapi.json`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.openapi, '3.0.3');
      assert.ok(json.paths['/health']);
    } finally {
      server.close();
    }
  });

  test('GET /api/docs serves Swagger UI HTML', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/docs/`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.match(text, /html/i);
    } finally {
      server.close();
    }
  });

  test('POST /api/v1/admin/drain validates security and input schema', async () => {
    const server = app.listen(0);
    const port = server.address().port;
    try {
      // 1. Missing auth header returns 401
      const res401 = await fetch(`http://127.0.0.1:${port}/api/v1/admin/drain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.equal(res401.status, 401);

      // 2. Invalid body type returns 400 with field detail
      const res400 = await fetch(`http://127.0.0.1:${port}/api/v1/admin/drain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token'
        },
        body: JSON.stringify({ drain_delay_ledgers: 'not-an-integer' })
      });
      assert.equal(res400.status, 400);
      const json = await res400.json();
      assert.ok(json.message);
      assert.ok(Array.isArray(json.errors));
    } finally {
      server.close();
    }
  });
});
