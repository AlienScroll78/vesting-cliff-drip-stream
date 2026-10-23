import { connect } from './pg.js';

const RESTORE_TEST_TAG = 'RestoreTest';
const MANAGED_BY_TAG = 'ManagedBy';
const MANAGED_BY_VALUE = 'vesting-backup-verify';

// The AWS SDK ships with the Node 22 Lambda runtime and is deliberately not
// vendored, so it is imported lazily here. That also keeps it out of this
// module's graph for the unit tests, which run without node_modules installed.
let sdk = null;
async function aws() {
  if (!sdk) {
    const [cloudwatch, rds] = await Promise.all([
      import('@aws-sdk/client-cloudwatch'),
      import('@aws-sdk/client-rds')
    ]);
    sdk = { ...cloudwatch, ...rds };
  }
  return sdk;
}

/** Tests inject stub command classes so this module loads without node_modules. */
const resolveSdk = async deps => deps?.sdk ?? (await aws());

const log = (level, msg, fields = {}) => {
  process.stdout.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: 'backup-verify',
      env: process.env.ENVIRONMENT ?? 'unknown',
      msg,
      ...fields
    })}\n`
  );
};

class CheckFailure extends Error {}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function config() {
  return {
    sourceInstance: required('SOURCE_DB_INSTANCE_ID'),
    dbUser: required('DB_USERNAME'),
    dbPassword: required('DB_PASSWORD'),
    dbName: required('DB_NAME'),
    dbPort: Number(process.env.DB_PORT ?? 5432),
    securityGroupIds: required('SECURITY_GROUP_IDS').split(',').map(s => s.trim()).filter(Boolean),
    instanceClass: process.env.RESTORE_INSTANCE_CLASS ?? 'db.t3.micro',
    identifierPrefix: process.env.RESTORE_ID_PREFIX ?? 'vesting-restore-test',
    tables: required('EXPECTED_TABLES').split(',').map(s => s.trim()).filter(Boolean),
    namespace: process.env.METRIC_NAMESPACE ?? 'VestingApp',
    metricName: process.env.METRIC_NAME ?? 'BackupRestoreSuccess',
    environment: process.env.ENVIRONMENT ?? 'unknown',
    restoreTimeoutMs: Number(process.env.RESTORE_TIMEOUT_MS ?? 30 * 60 * 1000),
    deleteTimeoutMs: Number(process.env.DELETE_TIMEOUT_MS ?? 10 * 60 * 1000),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30 * 1000)
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Polls `probe` until it reports done or the budget runs out.
 *
 * The deadline is checked before each sleep as well, so a poll interval longer
 * than the remaining budget cannot push the caller past its own timeout. On
 * timeout the last observed state is thrown, because "timed out waiting for X"
 * is only actionable if it says what X was last seen doing.
 */
async function waitFor(probe, { timeoutMs, intervalMs, description }) {
  const deadline = Date.now() + timeoutMs;
  let last;

  for (;;) {
    const state = await probe();
    if (state.done) return state.value;
    last = state.detail;
    if (Date.now() + intervalMs >= deadline) {
      throw new Error(
        `timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${description}` +
          (last ? ` (last seen: ${last})` : '')
      );
    }
    log('debug', 'polling', { description, detail: last });
    await sleep(intervalMs);
  }
}

const isNotFound = err =>
  err?.name === 'DBInstanceNotFound' || err?.name === 'DBInstanceNotFoundFault';

/**
 * Deletes restore-test instances left behind by a run that died.
 *
 * Two independent conditions must hold before anything is deleted: the
 * identifier must start with this function's prefix, and the instance must carry
 * RestoreTest=true. A run that times out mid-restore never reaches its own
 * cleanup, so this is what keeps a failed check from billing for a database
 * until someone notices. The conjunction is deliberate: either check alone would
 * be a foot-gun pointed at the production instance.
 */
async function deleteStrayInstances(rds, cfg, sdk) {
  const { DescribeDBInstancesCommand, DeleteDBInstanceCommand } = sdk;

  const listed = await rds.send(
    new DescribeDBInstancesCommand({
      Filters: [
        { Name: `tag:${RESTORE_TEST_TAG}`, Values: ['true'] },
        { Name: 'db-instance-id', Values: [`${cfg.identifierPrefix}-*`] }
      ]
    })
  );

  const strays = (listed.DBInstances ?? []).filter(
    db => db.DBInstanceIdentifier.startsWith(`${cfg.identifierPrefix}-`)
  );

  for (const db of strays) {
    const id = db.DBInstanceIdentifier;
    log('warn', 'deleting leftover restore-test instance', { instance: id, state: db.DBInstanceStatus });
    await rds.send(
      new DeleteDBInstanceCommand({
        DBInstanceIdentifier: id,
        SkipFinalSnapshot: true,
        DeleteAutomatedBackups: true
      })
    );
  }

  return strays.length;
}

async function waitForDeleted(rds, id, cfg, sdk) {
  const { DescribeDBInstancesCommand } = sdk;

  await waitFor(
    async () => {
      try {
        const res = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }));
        const status = res.DBInstances?.[0]?.DBInstanceStatus;
        return { done: false, detail: status };
      } catch (err) {
        if (isNotFound(err)) return { done: true, value: true };
        throw err;
      }
    },
    {
      timeoutMs: cfg.deleteTimeoutMs,
      intervalMs: cfg.pollIntervalMs,
      description: `${id} to be deleted`
    }
  );
}

/**
 * Picks the most recent automated snapshot that is actually restorable.
 *
 * Automated snapshots are retained for a short window, so the list can include
 * ones that are still copying; those are filtered on status rather than trusted,
 * because restoring from a `creating` snapshot fails with an error that does not
 * say which snapshot was at fault.
 */
async function latestRestorableSnapshot(rds, cfg, sdk) {
  const { DescribeDBSnapshotsCommand } = sdk;

  const res = await rds.send(
    new DescribeDBSnapshotsCommand({
      DBInstanceIdentifier: cfg.sourceInstance,
      SnapshotType: 'automated',
      Status: 'available'
    })
  );

  const snapshots = res.DBSnapshots ?? [];
  if (snapshots.length === 0) {
    throw new Error(
      `no available automated snapshot found for ${cfg.sourceInstance}; automated backups may be disabled or expired`
    );
  }

  const newest = snapshots
    .slice()
    .sort((a, b) => new Date(b.SnapshotCreateTime) - new Date(a.SnapshotCreateTime))[0];

  log('info', 'selected snapshot', {
    snapshot: newest.DBSnapshotIdentifier,
    created: newest.SnapshotCreateTime,
    candidates: snapshots.length
  });

  return newest.DBSnapshotIdentifier;
}

function newInstanceId(cfg) {
  // RDS requires lowercase alphanumerics and hyphens, starting with a letter,
  // at most 63 characters. Digits only for the stamp: it avoids the uppercase
  // 'T' an ISO timestamp would carry, which the API silently lowercases and
  // which would then not match the identifier this function logged.
  const stamp = nowUtcDigits();
  const id = `${cfg.identifierPrefix}-${stamp}`;
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) {
    throw new Error(`generated an invalid DB instance identifier: ${id}`);
  }
  return id;
}

/** YYYYMMDDhhmmss in UTC. */
function nowUtcDigits(date = new Date()) {
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

async function restoreSnapshot(rds, cfg, snapshotId, sdk) {
  const { RestoreDBInstanceFromDBSnapshotCommand, DescribeDBInstancesCommand } = sdk;

  const id = newInstanceId(cfg);
  log('info', 'restoring snapshot', { snapshot: snapshotId, instance: id, dbClass: cfg.instanceClass });

  await rds.send(
    new RestoreDBInstanceFromDBSnapshotCommand({
      DBInstanceIdentifier: id,
      DBSnapshotIdentifier: snapshotId,
      DBInstanceClass: cfg.instanceClass,
      VPCSecurityGroupIds: cfg.securityGroupIds,
      PubliclyAccessible: false,
      // A temporary instance must not generate its own automated backups: they
      // are pure cost and they delay the delete.
      BackupRetentionPeriod: 0,
      DeletionProtection: false,
      CopyTagsToSnapshot: false,
      TagSpecifications: [
        {
          ResourceType: 'db',
          Tags: [
            { Key: RESTORE_TEST_TAG, Value: 'true' },
            { Key: MANAGED_BY_TAG, Value: MANAGED_BY_VALUE }
          ]
        }
      ]
    })
  );

  await waitFor(
    async () => {
      const res = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }));
      const db = res.DBInstances?.[0];
      const status = db?.DBInstanceStatus;
      if (status === 'available') return { done: true, value: db };
      if (status === 'failed' || db?.DBInstanceStatus === 'incompatible-restore') {
        throw new CheckFailure(`restore of ${snapshotId} ended in state ${status}`);
      }
      return { done: false, detail: status };
    },
    {
      timeoutMs: cfg.restoreTimeoutMs,
      intervalMs: cfg.pollIntervalMs,
      description: `${id} to become available`
    }
  );

  return id;
}

/**
 * Counts rows in each expected table.
 *
 * The table names come from configuration, so they are validated rather than
 * interpolated blindly -- this is a fixed allowlist in practice, but an
 * identifier that fails this check is a configuration mistake we want reported,
 * not executed. Each count is a separate statement because the simple query
 * protocol would otherwise return several result sets that the client cannot
 * tell apart.
 */
async function verifyTables(cfg, endpoint, connectFn = connect) {
  const db = await connectFn({
    host: endpoint,
    port: cfg.dbPort,
    user: cfg.dbUser,
    password: cfg.dbPassword,
    database: cfg.dbName
  });

  try {
    const counts = {};
    for (const table of cfg.tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
        throw new CheckFailure(`refusing to query unexpected table name: ${table}`);
      }
      const { rows } = await db.query(`SELECT count(*)::bigint AS n FROM "${table}"`);
      const n = Number(rows[0]?.n);
      if (!Number.isInteger(n) || n < 0) {
        throw new CheckFailure(`could not read a row count for ${table}: ${JSON.stringify(rows[0])}`);
      }
      counts[table] = n;
    }
    return counts;
  } finally {
    db.end();
  }
}

async function publishMetric(cloudwatch, cfg, value, dimensions, sdk) {
  const { PutMetricDataCommand } = sdk;

  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: cfg.namespace,
      MetricData: [
        {
          MetricName: cfg.metricName,
          Value: value,
          Unit: 'None',
          // The alarm declares this same dimension. Keeping them in step matters:
          // a metric published with dimensions an alarm does not declare never
          // satisfies it, and the failure is invisible until you page for it.
          Dimensions: dimensions
        }
      ]
    })
  );
}

/**
 * Runs one restore verification end to end.
 *
 * The instance is deleted in a `finally` block, and the metric is published in
 * both branches, so a failed check still pages and still cleans up after itself.
 * `deps` is injected so the whole flow is testable without AWS.
 */
export async function runBackupVerify(deps, event = {}) {
  const { rds, cloudwatch, now = () => new Date(), connectFn = connect } = deps;
  const cfg = config();
  const sdk = await resolveSdk(deps);
  const { DescribeDBInstancesCommand, DeleteDBInstanceCommand } = sdk;
  const startedAt = now();
  const dimensions = [{ Name: 'Environment', Value: cfg.environment }];

  log('info', 'backup verification starting', {
    source: cfg.sourceInstance,
    trigger: event['detail-type'] ?? event.action ?? 'manual',
    expectedTables: cfg.tables
  });

  const strays = await deleteStrayInstances(rds, cfg, sdk);
  if (strays > 0) log('warn', 'cleaned up instances from a previous run', { count: strays });

  let instanceId = null;
  let ok = false;
  let counts = null;
  let failure = null;

  try {
    const snapshotId = await latestRestorableSnapshot(rds, cfg, sdk);
    instanceId = await restoreSnapshot(rds, cfg, snapshotId, sdk);

    const res = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: instanceId }));
    const endpoint = res.DBInstances?.[0]?.Endpoint?.Address;
    if (!endpoint) throw new CheckFailure(`${instanceId} has no endpoint to connect to`);

    counts = await verifyTables(cfg, endpoint, connectFn);
    ok = true;
    log('info', 'restore verification passed', { instance: instanceId, snapshot: snapshotId, rowCounts: counts });
  } catch (err) {
    failure = err;
    log('error', 'restore verification failed', {
      instance: instanceId,
      error: err.message,
      code: err.name
    });
  } finally {
    if (instanceId) {
      try {
        await rds.send(
          new DeleteDBInstanceCommand({
            DBInstanceIdentifier: instanceId,
            SkipFinalSnapshot: true,
            DeleteAutomatedBackups: true
          })
        );
        await waitForDeleted(rds, instanceId, cfg, sdk);
        log('info', 'deleted temporary instance', { instance: instanceId });
      } catch (err) {
        // A failure here is the one that leaks money, so it is logged at error
        // and left for the next run's preflight rather than swallowed.
        log('error', 'could not delete temporary instance', { instance: instanceId, error: err.message });
      }
    }

    try {
      await publishMetric(cloudwatch, cfg, ok ? 1 : 0, dimensions, sdk);
    } catch (err) {
      log('error', 'could not publish result metric', { error: err.message });
    }
  }

  const durationMs = now() - startedAt;
  log(ok ? 'info' : 'error', 'backup verification finished', {
    instance: instanceId,
    ok,
    durationMs,
    rowCounts: counts
  });

  if (!ok) {
    const err = failure ?? new CheckFailure('backup verification failed for an unknown reason');
    err.restoreInstance = instanceId;
    throw err;
  }
  return { ok: true, instanceId, counts, durationMs };
}

/** Removes leftovers only. Invoked on its own schedule so a timed-out run that
 * never reached its own cleanup is still collected. */
export async function runCleanup(deps) {
  const { rds } = deps;
  const cfg = config();
  const removed = await deleteStrayInstances(rds, cfg, await resolveSdk(deps));
  log('info', 'cleanup complete', { removed });
  return { removed };
}

export const handler = async (event = {}) => {
  const { RDSClient, CloudWatchClient } = await aws();
  const deps = {
    rds: new RDSClient({}),
    cloudwatch: new CloudWatchClient({})
  };

  if (event.action === 'cleanup') return runCleanup(deps);
  return runBackupVerify(deps, event);
};
