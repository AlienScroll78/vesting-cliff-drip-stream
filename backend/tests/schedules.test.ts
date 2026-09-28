import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { AddressInfo } from 'node:net';
import { createServer } from 'node:http';

function startServer() {
  const server = createServer(app);
  server.listen(0);
  return new Promise<{ server: any; port: number }>((resolve) => {
    server.on('listening', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

function makeAddress(prefix: string) {
  return `${prefix}${'A'.repeat(55)}`;
}

test('returns a vesting schedule with computed fields', async () => {
  const { server, port } = await startServer();
  try {
    const recipient = makeAddress('G');
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/schedules/${recipient}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.recipient, recipient);
    assert.equal(body.claimable_amount, 1000);
    assert.equal(body.is_cliff_passed, true);
  } finally {
    server.close();
  }
});

test('returns 404 when no schedule exists', async () => {
  const { server, port } = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/schedules/${'G' + 'A'.repeat(54) + 'B'}`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Schedule not found');
  } finally {
    server.close();
  }
});

test('rejects invalid Stellar addresses with 400', async () => {
  const { server, port } = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/schedules/not-an-address`);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Invalid Stellar address');
  } finally {
    server.close();
  }
});
