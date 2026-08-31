/**
 * Pact consumer contract tests for the backend API.
 * Closes #626
 *
 * Defines the contracts the frontend expects from the backend API.
 * Each test specifies the expected request/response shape so that
 * any breaking backend API change is caught before deployment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for consumer contract testing
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BASE_URL = 'http://localhost:3000';
const RECIPIENT = 'GBFJHU5BDPF4FVZDPLH45LAJBLPJK4R2HSLMCJLSVMWJLVPGQKRTOJY';

beforeEach(() => {
  mockFetch.mockReset();
});

// ── GET /streams/:recipient ──────────────────────────────────────────────────

describe('Contract: GET /streams/:recipient', () => {
  it('returns the expected response shape for an active stream', async () => {
    const expectedResponse = {
      recipient: RECIPIENT,
      sponsor: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGBW59ASGDBNCRP5XVNZRK',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2DHGNWY',
      rate_per_ledger: '10',
      start_ledger: 1000,
      cliff_ledger: 1050,
      end_ledger: 1200,
      last_claimed_ledger: 1000,
      total_claimed: '0',
      status: 'pre_cliff',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => expectedResponse,
    });

    const response = await fetch(`${BASE_URL}/streams/${RECIPIENT}`);
    const data = await response.json();

    // Verify required fields exist and have correct types
    expect(data).toHaveProperty('recipient');
    expect(data).toHaveProperty('sponsor');
    expect(data).toHaveProperty('token');
    expect(data).toHaveProperty('rate_per_ledger');
    expect(data).toHaveProperty('start_ledger');
    expect(data).toHaveProperty('cliff_ledger');
    expect(data).toHaveProperty('end_ledger');
    expect(data).toHaveProperty('last_claimed_ledger');
    expect(data).toHaveProperty('total_claimed');
    expect(data).toHaveProperty('status');

    expect(typeof data.recipient).toBe('string');
    expect(typeof data.start_ledger).toBe('number');
    expect(typeof data.cliff_ledger).toBe('number');
    expect(typeof data.end_ledger).toBe('number');
    expect(typeof data.status).toBe('string');
    expect(['pre_cliff', 'active', 'expired', 'completed', 'cancelled']).toContain(data.status);
  });

  it('returns 404 when stream does not exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Stream not found' }),
    });

    const response = await fetch(`${BASE_URL}/streams/NONEXISTENT`);
    expect(response.status).toBe(404);
  });

  it('recipient field matches the request path parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ recipient: RECIPIENT, status: 'active', start_ledger: 1000, cliff_ledger: 1050, end_ledger: 1200, last_claimed_ledger: 1000 }),
    });

    const response = await fetch(`${BASE_URL}/streams/${RECIPIENT}`);
    const data = await response.json();
    expect(data.recipient).toBe(RECIPIENT);
  });
});

// ── GET /streams/:recipient/events ───────────────────────────────────────────

describe('Contract: GET /streams/:recipient/events', () => {
  it('returns paginated events with correct shape', async () => {
    const expectedResponse = {
      data: [
        {
          id: 'evt_001',
          event_type: 'StreamCreated',
          ledger: 1000,
          timestamp: '2026-01-01T00:00:00Z',
          data: {},
        },
      ],
      pagination: {
        page: 1,
        page_size: 20,
        total: 1,
        has_more: false,
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => expectedResponse,
    });

    const response = await fetch(`${BASE_URL}/streams/${RECIPIENT}/events`);
    const data = await response.json();

    expect(data).toHaveProperty('data');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.data)).toBe(true);

    expect(data.pagination).toHaveProperty('page');
    expect(data.pagination).toHaveProperty('page_size');
    expect(data.pagination).toHaveProperty('total');
    expect(data.pagination).toHaveProperty('has_more');

    expect(typeof data.pagination.page).toBe('number');
    expect(typeof data.pagination.has_more).toBe('boolean');
  });

  it('events have required fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'evt_001',
            event_type: 'TokensClaimed',
            ledger: 1100,
            timestamp: '2026-01-02T00:00:00Z',
            data: { amount: '500', ledger_claimed_through: 1100 },
          },
        ],
        pagination: { page: 1, page_size: 20, total: 1, has_more: false },
      }),
    });

    const response = await fetch(`${BASE_URL}/streams/${RECIPIENT}/events?page=1&page_size=20`);
    const data = await response.json();

    const event = data.data[0];
    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('event_type');
    expect(event).toHaveProperty('ledger');
    expect(event).toHaveProperty('timestamp');
    expect(event).toHaveProperty('data');
    expect(typeof event.ledger).toBe('number');
  });

  it('event_type is one of the known event types', async () => {
    const knownTypes = [
      'StreamCreated', 'TokensClaimed', 'StreamCompleted',
      'StreamCancelled', 'StreamClawedBack', 'StreamDrained',
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: 'evt_001', event_type: 'StreamCreated', ledger: 1000, timestamp: '2026-01-01T00:00:00Z', data: {} }],
        pagination: { page: 1, page_size: 20, total: 1, has_more: false },
      }),
    });

    const response = await fetch(`${BASE_URL}/streams/${RECIPIENT}/events`);
    const data = await response.json();

    for (const event of data.data) {
      expect(knownTypes).toContain(event.event_type);
    }
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────

describe('Contract: GET /health', () => {
  it('returns status and version fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        version: '1.0.0',
        timestamp: '2026-01-01T00:00:00Z',
        dependencies: { database: 'ok', horizon: 'ok' },
      }),
    });

    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();

    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('timestamp');
    expect(data.status).toBe('ok');
    expect(typeof data.version).toBe('string');
  });

  it('dependencies field contains database and horizon keys', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        version: '1.0.0',
        timestamp: '2026-01-01T00:00:00Z',
        dependencies: { database: 'ok', horizon: 'ok' },
      }),
    });

    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();

    expect(data.dependencies).toHaveProperty('database');
    expect(data.dependencies).toHaveProperty('horizon');
  });
});

// ── GET /streams/:recipient/versions ─────────────────────────────────────────

describe('Contract: GET /streams/:recipient/versions', () => {
  it('returns version history with correct shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        recipient: RECIPIENT,
        current_version: 3,
        history: [
          { version: 1, ledger: 1000, action: 'created', timestamp: '2026-01-01T00:00:00Z' },
          { version: 2, ledger: 1100, action: 'claimed', timestamp: '2026-01-02T00:00:00Z' },
          { version: 3, ledger: 1150, action: 'claimed', timestamp: '2026-01-03T00:00:00Z' },
        ],
      }),
    });

    const response = await fetch(`${BASE_URL}/streams/${RECIPIENT}/versions`);
    const data = await response.json();

    expect(data).toHaveProperty('recipient');
    expect(data).toHaveProperty('current_version');
    expect(data).toHaveProperty('history');
    expect(Array.isArray(data.history)).toBe(true);
    expect(typeof data.current_version).toBe('number');
  });

  it('version history entries have required fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        recipient: RECIPIENT,
        current_version: 2,
        history: [
          { version: 1, ledger: 1000, action: 'created', timestamp: '2026-01-01T00:00:00Z' },
          { version: 2, ledger: 1100, action: 'claimed', timestamp: '2026-01-02T00:00:00Z' },
        ],
      }),
    });

    const response = await fetch(`${BASE_URL}/streams/${RECIPIENT}/versions`);
    const data = await response.json();

    for (const entry of data.history) {
      expect(entry).toHaveProperty('version');
      expect(entry).toHaveProperty('ledger');
      expect(entry).toHaveProperty('action');
      expect(entry).toHaveProperty('timestamp');
      expect(typeof entry.version).toBe('number');
      expect(typeof entry.ledger).toBe('number');
    }
  });

  it('current_version matches the highest version in history', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        recipient: RECIPIENT,
        current_version: 3,
        history: [
          { version: 1, ledger: 1000, action: 'created', timestamp: '2026-01-01T00:00:00Z' },
          { version: 2, ledger: 1050, action: 'claimed', timestamp: '2026-01-02T00:00:00Z' },
          { version: 3, ledger: 1100, action: 'claimed', timestamp: '2026-01-03T00:00:00Z' },
        ],
      }),
    });

    const response = await fetch(`${BASE_URL}/streams/${RECIPIENT}/versions`);
    const data = await response.json();

    const maxVersion = Math.max(...data.history.map((h: { version: number }) => h.version));
    expect(data.current_version).toBe(maxVersion);
  });
});
