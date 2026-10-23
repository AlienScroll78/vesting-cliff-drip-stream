import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Logger } from './logger.js';

const FIXED_TS = '2026-09-28T12:00:00.000Z';

function readRecords(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

describe('Logger', () => {
  test('writes one JSON object per line with the fields the metric filters match on', () => {
    const file = join(tmpdir(), `logger-${process.pid}-a.log`);
    const log = new Logger({ file, service: 'api-server', env: 'staging', now: () => FIXED_TS });

    log.info('server listening', { port: 3000 });
    log.error('claim failed', { claimId: 'c-1' });

    const records = readRecords(file);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], {
      ts: FIXED_TS,
      level: 'info',
      service: 'api-server',
      env: 'staging',
      msg: 'server listening',
      port: 3000
    });
    assert.equal(records[1].level, 'error');
    rmSync(file, { force: true });
  });

  test('serializes an Error into message and stack rather than an empty object', () => {
    const file = join(tmpdir(), `logger-${process.pid}-b.log`);
    const log = new Logger({ file, now: () => FIXED_TS });

    log.error('teardown failed', { err: new TypeError('boom') });

    const [record] = readRecords(file);
    assert.equal(record.err.name, 'TypeError');
    assert.equal(record.err.message, 'boom');
    assert.match(record.err.stack, /TypeError: boom/);
    rmSync(file, { force: true });
  });

  test('survives a circular reference instead of throwing', () => {
    const file = join(tmpdir(), `logger-${process.pid}-c.log`);
    const log = new Logger({ file, now: () => FIXED_TS });

    const node = { name: 'root' };
    node.self = node;

    log.info('cyclic payload', { node });

    const [record] = readRecords(file);
    assert.equal(record.node.self, '[Circular]');
    rmSync(file, { force: true });
  });

  test('applies child bindings without mutating the parent', () => {
    const file = join(tmpdir(), `logger-${process.pid}-d.log`);
    const log = new Logger({ file, service: 'indexer', now: () => FIXED_TS });
    const scoped = log.child({ stream: 'horizon' });

    scoped.warn('cursor behind');
    log.info('unbound');

    const records = readRecords(file);
    assert.equal(records[0].stream, 'horizon');
    assert.equal(records[0].service, 'indexer');
    assert.equal(records[1].stream, undefined);
    rmSync(file, { force: true });
  });

  test('drops records below the configured level', () => {
    const file = join(tmpdir(), `logger-${process.pid}-e.log`);
    const log = new Logger({ file, level: 'warn', now: () => FIXED_TS });

    log.debug('noisy');
    log.info('routine');
    log.warn('kept');
    log.error('kept too');

    const records = readRecords(file);
    assert.deepEqual(records.map(r => r.level), ['warn', 'error']);
    rmSync(file, { force: true });
  });

  test('keeps running when the log file cannot be written', () => {
    const log = new Logger({ file: join(tmpdir(), 'no-such-dir', 'nope.log'), now: () => FIXED_TS });
    assert.doesNotThrow(() => log.error('unwritable target'));
  });
});
