import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runBackupVerify, runCleanup } from './index.js';

// Stub command classes. The real AWS SDK is not vendored (it ships with the
// Lambda runtime), so tests stand these in; the clients branch on
// constructor.name, which these preserve.
const stubSdk = () => {
  const make = name => {
    const C = class {
      constructor(input) {
        this.input = input;
      }
    };
    // Anonymous classes report an empty constructor.name; force it so the
    // clients can branch the way the real commands do.
    Object.defineProperty(C, 'name', { value: name });
    return C;
  };
  return {
    DescribeDBSnapshotsCommand: make('DescribeDBSnapshotsCommand'),
    DescribeDBInstancesCommand: make('DescribeDBInstancesCommand'),
    DeleteDBInstanceCommand: make('DeleteDBInstanceCommand'),
    RestoreDBInstanceFromDBSnapshotCommand: make('RestoreDBInstanceFromDBSnapshotCommand'),
    PutMetricDataCommand: make('PutMetricDataCommand')
  };
};

const named = command => command.constructor.name;

// Records the call order, because "the instance is deleted even when the check
// fails" is only meaningful if the delete is actually asserted.
function makeDeps({ snapshots, instanceStatus = 'available', throwOn, strays = [] } = {}) {
  const calls = [];
  const metrics = [];
  const restoreInputs = [];
  const deleted = [];
  let torndown = false;

  const rds = {
    async send(command) {
      const name = named(command);
      if (throwOn === name) throw new Error(`injected failure in ${name}`);
      calls.push(name);

      switch (name) {
        case 'DescribeDBSnapshotsCommand':
          return { DBSnapshots: snapshots };
        case 'RestoreDBInstanceFromDBSnapshotCommand':
          restoreInputs.push(command.input);
          return {};
        case 'DeleteDBInstanceCommand':
          deleted.push(command.input.DBInstanceIdentifier);
          torndown = true;
          return {};
        case 'DescribeDBInstancesCommand': {
          const id = command.input.DBInstanceIdentifier;
          // No identifier means the preflight sweep, which filters by tag.
          if (!id) return { DBInstances: strays };
          if (torndown) {
            const err = new Error(`${id} not found`);
            err.name = 'DBInstanceNotFound';
            throw err;
          }
          return {
            DBInstances: [
              {
                DBInstanceIdentifier: id,
                DBInstanceStatus: instanceStatus,
                Endpoint: { Address: `${id}.abcdefg.us-east-1.rds.amazonaws.com` }
              }
            ]
          };
        }
        default:
          throw new Error(`unexpected command ${name}`);
      }
    }
  };

  const cloudwatch = {
    async send(command) {
      if (throwOn === 'PutMetricDataCommand') throw new Error('injected PutMetricData failure');
      calls.push('PutMetricDataCommand');
      metrics.push(command.input.MetricData[0]);
      return {};
    }
  };

  const counts = { schedules: 7, events: 42, claims: 128 };
  const connectFn = async () => ({
    query: async sql => {
      const m = /FROM "(\w+)"/.exec(sql);
      return { rows: [{ n: String(counts[m[1]] ?? 0) }] };
    },
    end: () => {}
  });

  return {
    deps: { rds, cloudwatch, sdk: stubSdk(), connectFn },
    calls,
    metrics,
    deleted,
    restoreInputs,
    counts
  };
}

const ENV = {
  ENVIRONMENT: 'test',
  SOURCE_DB_INSTANCE_ID: 'vesting-prod',
  DB_USERNAME: 'vesting',
  DB_PASSWORD: 'secret',
  DB_NAME: 'vesting',
  SECURITY_GROUP_IDS: 'sg-1, sg-2',
  EXPECTED_TABLES: 'schedules, events, claims',
  POLL_INTERVAL_MS: '1',
  RESTORE_TIMEOUT_MS: '100',
  DELETE_TIMEOUT_MS: '100'
};

async function withEnv(overrides, fn) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries({ ...ENV, ...overrides })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    process.env = saved;
  }
}

const SNAPSHOTS = [
  { DBSnapshotIdentifier: 'vesting-prod:2026-09-20-10-00', SnapshotCreateTime: '2026-09-20T10:00:00.000Z' },
  { DBSnapshotIdentifier: 'vesting-prod:2026-09-21-10-00', SnapshotCreateTime: '2026-09-21T10:00:00.000Z' }
];

describe('runBackupVerify', () => {
  test('publishes 1, reports row counts and deletes the instance on success', async () => {
    const f = makeDeps({ snapshots: SNAPSHOTS });

    const result = await withEnv({}, () => runBackupVerify(f.deps, { 'detail-type': 'Scheduled Event' }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.counts, f.counts);
    assert.equal(f.metrics.length, 1);
    assert.equal(f.metrics[0].Value, 1);
    assert.equal(f.deleted.length, 1, 'the temporary instance must be deleted');
  });

  test('restores the newest snapshot, not the first one returned', async () => {
    const f = makeDeps({ snapshots: SNAPSHOTS });

    await withEnv({}, () => runBackupVerify(f.deps));

    assert.equal(
      f.restoreInputs[0].DBSnapshotIdentifier,
      'vesting-prod:2026-09-21-10-00',
      'DescribeDBSnapshots returns newest-first, but the choice must not depend on that'
    );
  });

  test('marks the temporary instance so cleanup can find it, and disables its backups', async () => {
    const f = makeDeps({ snapshots: SNAPSHOTS });

    await withEnv({}, () => runBackupVerify(f.deps));

    const input = f.restoreInputs[0];
    const tags = Object.fromEntries(input.TagSpecifications[0].Tags.map(t => [t.Key, t.Value]));
    assert.equal(tags.RestoreTest, 'true');
    assert.equal(input.BackupRetentionPeriod, 0, 'a temp instance must not generate automated backups');
    assert.equal(input.PubliclyAccessible, false);
    assert.deepEqual(input.VPCSecurityGroupIds, ['sg-1', 'sg-2']);
  });

  test('publishes 0 and still deletes the instance when verification fails', async () => {
    const f = makeDeps({ snapshots: SNAPSHOTS });
    f.deps.connectFn = async () => {
      throw new Error('connect ECONNREFUSED');
    };

    await withEnv({}, async () => {
      await assert.rejects(() => runBackupVerify(f.deps), /ECONNREFUSED/);
    });

    assert.equal(f.metrics[0].Value, 0, 'a failed check must publish 0, not stay silent');
    assert.equal(f.deleted.length, 1, 'the instance must be deleted even when the check fails');
  });

  test('deletes the instance before publishing the metric', async () => {
    const f = makeDeps({ snapshots: SNAPSHOTS });

    await withEnv({}, () => runBackupVerify(f.deps));

    assert.ok(
      f.calls.indexOf('DeleteDBInstanceCommand') < f.calls.indexOf('PutMetricDataCommand'),
      'cleanup must not depend on the metric publish succeeding'
    );
  });

  test('still deletes the instance when publishing the metric throws', async () => {
    const f = makeDeps({ snapshots: SNAPSHOTS, throwOn: 'PutMetricDataCommand' });

    await withEnv({}, async () => {
      // The check itself passed, so this resolves; the metric failure is logged.
      const result = await runBackupVerify(f.deps);
      assert.equal(result.ok, true);
    });

    assert.equal(f.deleted.length, 1);
  });

  test('generates an identifier RDS will accept', async () => {
    // RDS rejects identifiers with uppercase letters or a leading digit, and
    // silently lowercases what it is given, so a stamp carrying an ISO "T"
    // would no longer match the identifier this function logged.
    const f = makeDeps({ snapshots: SNAPSHOTS });

    await withEnv({}, () => runBackupVerify(f.deps));

    const id = f.restoreInputs[0].DBInstanceIdentifier;
    assert.match(id, /^vesting-restore-test-\d{14}$/);
    assert.ok(id.length <= 63, `RDS caps identifiers at 63 characters: ${id.length}`);
    assert.ok(id === id.toLowerCase());
  });

  test('fails loudly when there are no automated snapshots', async () => {
    const f = makeDeps({ snapshots: [] });

    await withEnv({}, async () => {
      await assert.rejects(() => runBackupVerify(f.deps), /no available automated snapshot/);
    });

    assert.equal(f.deleted.length, 0, 'nothing to delete if no instance was created');
    assert.equal(f.metrics[0].Value, 0);
  });

  test('treats a failed restore as a failure instead of waiting for it', async () => {
    const f = makeDeps({ snapshots: SNAPSHOTS, instanceStatus: 'failed' });

    await withEnv({}, async () => {
      await assert.rejects(() => runBackupVerify(f.deps), /ended in state failed/);
    });

    assert.equal(f.metrics[0].Value, 0);
  });

  test('a missing password is a config error and must not page', async () => {
    const f = makeDeps({ snapshots: SNAPSHOTS });

    await withEnv({ DB_PASSWORD: undefined }, async () => {
      await assert.rejects(() => runBackupVerify(f.deps), /DB_PASSWORD is not set/);
    });

    assert.equal(f.metrics.length, 0, 'a misconfigured deploy is not a failed restore');
  });
});

describe('runCleanup', () => {
  const makeCleanupRds = (instances, deleted) => ({
    async send(command) {
      const name = named(command);
      if (name === 'DescribeDBInstancesCommand') return { DBInstances: instances };
      if (name === 'DeleteDBInstanceCommand') {
        deleted.push(command.input.DBInstanceIdentifier);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    }
  });

  test('deletes leftover restore-test instances', async () => {
    const deleted = [];
    const rds = makeCleanupRds(
      [
        { DBInstanceIdentifier: 'vesting-restore-test-20260921030012', DBInstanceStatus: 'available' },
        { DBInstanceIdentifier: 'vesting-restore-test-20260922030012', DBInstanceStatus: 'creating' }
      ],
      deleted
    );

    await withEnv({}, async () => {
      const res = await runCleanup({ rds, sdk: stubSdk() });
      assert.equal(res.removed, 2);
    });

    assert.equal(deleted.length, 2);
  });

  test('never deletes an instance outside the restore-test prefix', async () => {
    const deleted = [];
    const rds = makeCleanupRds(
      [{ DBInstanceIdentifier: 'vesting-prod', DBInstanceStatus: 'available' }],
      deleted
    );

    await withEnv({}, async () => {
      const res = await runCleanup({ rds, sdk: stubSdk() });
      assert.equal(res.removed, 0, 'the production instance must never be swept up');
    });

    assert.deepEqual(deleted, []);
  });
});
