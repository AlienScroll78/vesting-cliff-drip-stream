'use strict';

/**
 * AWS Secrets Manager rotation for the PostgreSQL master password.
 *
 * The password is replaced in place with RDS ModifyDBInstance, so the instance
 * stays available for the whole rotation and tasks only pick up the new
 * credential on their next start. Existing connections are never dropped.
 *
 * Implements the four-step rotation contract:
 *   createSecret  stage a new pending version
 *   setSecret     apply the pending password to the live instance
 *   testSecret    authenticate with the pending password
 *   finishSecret  promote the pending version to current
 *
 * The only dependency is the AWS SDK v3 bundled with the Node.js 20 runtime.
 * The PostgreSQL handshake used by testSecret is implemented directly on top of
 * net/tls so the function needs no npm packages and no vendored layer.
 */

const crypto = require('crypto');
const net = require('net');
const tls = require('tls');

const {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  UpdateSecretCommand,
  DescribeSecretCommand,
} = require('@aws-sdk/client-secrets-manager');

const {
  RDSClient,
  ModifyDBInstanceCommand,
  DescribeDBInstancesCommand,
} = require('@aws-sdk/client-rds');

const sm = new SecretsManagerClient({});
const rds = new RDSClient({});

const DB_INSTANCE_IDENTIFIER = process.env.DB_INSTANCE_IDENTIFIER;

// RDS rejects control characters, '/', '"', '@' and spaces in a master password,
// so the alphabet is drawn from a safe printable subset.
const PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.+!#%^*?';
const PASSWORD_LENGTH = 40;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function generatePassword() {
  const bytes = crypto.randomBytes(PASSWORD_LENGTH);
  let out = '';
  for (let i = 0; i < PASSWORD_LENGTH; i += 1) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  return out;
}

function buildDatabaseUrl(creds, password) {
  return `postgres://${creds.username}:${encodeURIComponent(password)}@${creds.host}:${creds.port}/${creds.dbname}`;
}

function log(event, message, extra) {
  console.log(
    JSON.stringify({
      rotation: 'db-credentials',
      step: event.Step,
      secretId: event.SecretId,
      message,
      ...extra,
    }),
  );
}

// ─── Secrets Manager helpers ────────────────────────────────────────────────

async function getSecret(secretId, stage) {
  const res = await sm.send(
    new GetSecretValueCommand({ SecretId: secretId, VersionStage: stage }),
  );
  return { ...JSON.parse(res.SecretString), versionId: res.VersionId };
}

async function waitForAvailable(dbInstanceIdentifier, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const res = await rds.send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: dbInstanceIdentifier }),
    );
    const status = res.DBInstances[0].DBInstanceStatus;

    if (status === 'available') return;

    if (Date.now() > deadline) {
      throw new Error(`instance ${dbInstanceIdentifier} still ${status} after ${timeoutMs}ms`);
    }

    await sleep(5000);
  }
}

// ─── createSecret ────────────────────────────────────────────────────────────

async function createSecret(event) {
  const current = await getSecret(event.SecretId, 'AWSCURRENT');

  try {
    await getSecret(event.SecretId, 'AWSPENDING');
    log(event, 'reusing staged pending version');
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;

    const password = generatePassword();
    await sm.send(
      new PutSecretValueCommand({
        SecretId: event.SecretId,
        ClientRequestToken: event.ClientRequestToken,
        SecretString: JSON.stringify({
          ...current,
          password,
          database_url: buildDatabaseUrl(current, password),
        }),
        VersionStages: ['AWSPENDING'],
      }),
    );
    log(event, 'staged new pending version', { host: current.host });
  }

  return { SecretId: event.SecretId, ClientRequestToken: event.ClientRequestToken };
}

// ─── setSecret ───────────────────────────────────────────────────────────────

async function setSecret(event) {
  const pending = await getSecret(event.SecretId, 'AWSPENDING');

  await rds.send(
    new ModifyDBInstanceCommand({
      DBInstanceIdentifier: DB_INSTANCE_IDENTIFIER,
      MasterUserPassword: pending.password,
      ApplyImmediately: true,
    }),
  );

  await waitForAvailable(DB_INSTANCE_IDENTIFIER, 15 * 60 * 1000);
  log(event, 'applied pending password to instance', { instance: DB_INSTANCE_IDENTIFIER });
}

// ─── Minimal PostgreSQL client ───────────────────────────────────────────────

const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);
const PROTOCOL_3_0 = 196608;

function startupMessage(user, database) {
  const params = Buffer.from(`user\0${user}\0database\0${database}\0\0`, 'utf8');
  const msg = Buffer.alloc(8 + params.length);
  msg.writeInt32BE(8 + params.length, 0);
  msg.writeInt32BE(PROTOCOL_3_0, 4);
  params.copy(msg, 8);
  return msg;
}

function typedMessage(type, payload) {
  const msg = Buffer.alloc(5 + payload.length);
  msg[0] = type.charCodeAt(0);
  msg.writeInt32BE(5 + payload.length, 1);
  payload.copy(msg, 5);
  return msg;
}

const passwordMessage = (digest) =>
  typedMessage('p', Buffer.from(digest, 'utf8'));

const queryMessage = (sql) => typedMessage('Q', Buffer.from(`${sql}\0`, 'utf8'));

function md5Digest(password, user, salt) {
  const inner = crypto.createHash('md5').update(password + user).digest('hex');
  return `md5${crypto
    .createHash('md5')
    .update(inner + salt.toString('hex'))
    .digest('hex')}`;
}

/**
 * Connects to PostgreSQL, negotiates TLS, authenticates with MD5 and runs a
 * single statement. Used to prove the pending password authenticates against
 * the live instance before it is promoted to AWSCURRENT.
 *
 * The TLS certificate is not verified: RDS presents a private CA that is not in
 * the Lambda trust store, and the connection terminates inside the VPC.
 */
function pgQuery({ host, port, user, password, database, query, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buffer = Buffer.alloc(0);
    let negotiating = true;
    let settled = false;
    let timer = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(true);
    };

    const drain = (stream) => {
      for (;;) {
        if (settled) return;

        if (negotiating) {
          if (buffer.length < 1) return;
          const flag = buffer[0];
          buffer = buffer.subarray(1);
          negotiating = false;

          if (flag === 0x53 /* 'S' */) {
            const secured = tls.connect(
              { socket: stream, servername: host, rejectUnauthorized: false },
              () => secured.write(startupMessage(user, database)),
            );
            secured.on('data', (chunk) => {
              buffer = Buffer.concat([buffer, chunk]);
              drain(secured);
            });
            secured.on('error', finish);
            return;
          }

          // 'N' — the server declines TLS, continue in cleartext.
          stream.write(startupMessage(user, database));
          continue;
        }

        if (buffer.length < 5) return;
        const type = String.fromCharCode(buffer[0]);
        const length = buffer.readInt32BE(1);
        if (buffer.length < length + 1) return;

        const body = buffer.subarray(5, length + 1);
        buffer = buffer.subarray(length + 1);

        if (type === 'R') {
          const authType = body.readInt32BE(0);
          if (authType === 0) {
            stream.write(queryMessage(query));
          } else if (authType === 5) {
            stream.write(passwordMessage(md5Digest(password, user, body.subarray(4, 8))));
          } else {
            finish(new Error(`unsupported postgres auth type ${authType}`));
          }
          continue;
        }

        if (type === 'Z') {
          finish(null);
          return;
        }

        if (type === 'E') {
          finish(new Error(`postgres error: ${body.toString('utf8')}`));
          return;
        }

        // ParameterStatus, BackendKeyData, NoticeResponse, RowDescription,
        // DataRow and CommandComplete carry no state this probe depends on.
      }
    };

    socket.on('error', finish);
    socket.on('connect', () => {
      timer = setTimeout(() => finish(new Error('postgres probe timed out')), timeoutMs);
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        drain(socket);
      });
      socket.write(SSL_REQUEST);
    });
  });
}

async function testSecret(event) {
  const pending = await getSecret(event.SecretId, 'AWSPENDING');

  await pgQuery({
    host: pending.host,
    port: pending.port,
    user: pending.username,
    password: pending.password,
    database: pending.dbname,
    query: 'SELECT 1',
    timeoutMs: 30000,
  });

  log(event, 'pending password authenticated', { host: pending.host });
}

// ─── finishSecret ────────────────────────────────────────────────────────────

async function finishSecret(event) {
  const described = await sm.send(
    new DescribeSecretCommand({ SecretId: event.SecretId }),
  );
  const stages = described.VersionIdsToStages || {};
  const ids = Object.keys(stages);

  const currentId = ids.find((id) => stages[id].includes('AWSCURRENT'));
  const pendingId = ids.find((id) => stages[id].includes('AWSPENDING'));
  const previousId = ids.find((id) => stages[id].includes('AWSPREVIOUS'));

  if (pendingId && currentId === pendingId) {
    log(event, 'pending version is already current, nothing to promote');
    return;
  }

  // A rollback leaves AWSCURRENT pointing at the previous version. Move it back
  // to pending so the next rotation starts from a known state.
  if (currentId && previousId && currentId === previousId) {
    await sm.send(
      new UpdateSecretCommand({
        SecretId: event.SecretId,
        VersionStages: [{ SecretId: event.SecretId, VersionStage: 'AWSPENDING' }],
      }),
    );
    log(event, 'restored rolled-back version to pending');
    return;
  }

  const versionStages = [
    { SecretId: event.SecretId, VersionStage: 'AWSPENDING' },
    { SecretId: event.SecretId, VersionStage: 'AWSCURRENT' },
  ];
  if (currentId) {
    versionStages.push({ SecretId: event.SecretId, VersionStage: 'AWSPREVIOUS' });
  }

  await sm.send(
    new UpdateSecretCommand({
      SecretId: event.SecretId,
      ClientRequestToken: event.ClientRequestToken,
      VersionStages: versionStages,
    }),
  );

  log(event, 'promoted pending version to current');
}

// ─── handler ─────────────────────────────────────────────────────────────────

const STEPS = {
  createSecret,
  setSecret,
  testSecret,
  finishSecret,
};

exports.handler = async (event) => {
  const step = STEPS[event.Step];
  if (!step) throw new Error(`unexpected rotation step: ${event.Step}`);

  try {
    return await step(event);
  } catch (err) {
    console.error(
      JSON.stringify({
        rotation: 'db-credentials',
        step: event.Step,
        error: err.name,
        message: err.message,
      }),
    );
    // Rethrow so the step is recorded as failed and the alarm fires. The
    // AWSPENDING version is deliberately left in place for inspection.
    throw err;
  }
};
