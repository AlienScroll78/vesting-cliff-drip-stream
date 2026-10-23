/**
 * Minimal PostgreSQL client, just enough to run a verification query against a
 * restored RDS instance.
 *
 * Why not `pg`? The Lambda is deployed as a plain zip built by Terraform's
 * archive_file, with no bundler and no node_modules. Adding a driver would mean
 * either vendoring a dependency or introducing a build step to this repo. The
 * subset of the wire protocol needed here -- connect, authenticate, run a simple
 * query, read the result -- is small and stable, and the alternative is not
 * restoring backups at all.
 *
 * Supports MD5, cleartext and SCRAM-SHA-256 authentication. TLS is required by
 * RDS, so the connection is always upgraded after the SSL negotiation.
 */

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

const SSL_REQUEST_CODE = 80877103;
const PROTOCOL_VERSION_3 = 196608; // major 3, minor 0
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

// ─── Message plumbing ────────────────────────────────────────────────────────

/** Splits the TCP byte stream into typed protocol messages. */
class MessageStream {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    this.failure = null;
  }

  _drain() {
    while (this.buffer.length >= 5) {
      // 1 byte tag + int32 length, where the length covers itself but not the tag.
      const length = this.buffer.readUInt32BE(1);

      if (length < 4 || length > MAX_MESSAGE_BYTES) {
        this.failure = new Error(`implausible message length ${length}`);
        this._reject();
        return;
      }
      if (this.buffer.length < length + 1) return;

      const tag = String.fromCharCode(this.buffer[0]);
      const body = this.buffer.subarray(5, length + 1);
      this.buffer = this.buffer.subarray(length + 1);

      if (this.pending) {
        const { resolve } = this.pending;
        this.pending = null;
        resolve({ tag, body });
      }
    }
  }

  _reject() {
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = null;
      reject(this.failure);
    }
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this._drain();
  }

  /** Resolves with the next tagged message. */
  next() {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this._drain();
    });
  }
}

function tagged(tag, payload) {
  const out = Buffer.alloc(payload.length + 5);
  out.write(tag, 0, 'ascii');
  out.writeInt32BE(payload.length + 4, 1);
  payload.copy(out, 5);
  return out;
}

function cstring(value) {
  return Buffer.concat([Buffer.from(String(value), 'utf8'), Buffer.from([0])]);
}

function startupMessage(params) {
  const chunks = [Buffer.alloc(4)];
  chunks[0].writeInt32BE(PROTOCOL_VERSION_3, 0);
  for (const [key, value] of Object.entries(params)) {
    chunks.push(cstring(key), cstring(value));
  }
  chunks.push(Buffer.from([0]));

  const body = Buffer.concat(chunks);
  const out = Buffer.alloc(body.length + 4);
  out.writeInt32BE(body.length + 4, 0);
  body.copy(out, 4);
  return out;
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Postgres MD5: md5( md5(password + user) + salt ), both hex.
 *
 * The salt is four arbitrary binary bytes, so it is hashed as raw bytes. It
 * must not be concatenated into a string first: doing so decodes it as UTF-8 and
 * replaces every byte above 0x7f with U+FFFD, which would corrupt most real
 * salts and fail the handshake for reasons that are impossible to read off the
 * server's error message.
 */
export function md5Password(user, password, salt) {
  const inner = createHash('md5').update(password + user, 'utf8').digest('hex');
  return 'md5' + createHash('md5').update(inner, 'utf8').update(salt).digest('hex');
}

/** Builds the client-first-message-bare, escaping '=' and ',' per RFC 5802. */
export function scramClientFirstBare(username, clientNonce) {
  const escaped = String(username).replace(/=/g, '=3D').replace(/,/g, '=2C');
  return `n=${escaped},r=${clientNonce}`;
}

/**
 * SCRAM-SHA-256 (RFC 5802/7677) without channel binding.
 *
 * The username is part of the authentication message, so it is built here from
 * the connection user rather than left to the caller to spell correctly --
 * getting it wrong yields an authentication failure indistinguishable from a
 * wrong password, which is a bad hour to discover during a restore test.
 *
 * Exported and tested against the RFC 7677 vector.
 */
export function scramClientProof({ password, username, clientNonce, serverFirst }) {
  const attrs = Object.fromEntries(
    serverFirst.split(',').map(part => {
      const eq = part.indexOf('=');
      return [part.slice(0, eq), part.slice(eq + 1)];
    })
  );

  const serverNonce = attrs.r;
  if (!serverNonce || !serverNonce.startsWith(clientNonce)) {
    throw new Error('SCRAM server nonce does not extend the client nonce');
  }

  const salt = Buffer.from(attrs.s, 'base64');
  const iterations = Number.parseInt(attrs.i, 10);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`SCRAM iteration count is invalid: ${attrs.i}`);
  }

  const clientFirstBare = scramClientFirstBare(username, clientNonce);

  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();

  // biws is base64("n,,"), the gs2 header with no channel binding.
  const clientFinalWithoutProof = `c=biws,r=${serverNonce}`;
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;

  const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();

  const proof = Buffer.alloc(clientKey.length);
  for (let i = 0; i < clientKey.length; i += 1) {
    proof[i] = clientKey[i] ^ clientSignature[i];
  }

  // ServerSignature = HMAC(ServerKey, AuthMessage), and ServerKey is derived
  // from the salted password -- not from the stored key, and not by prefixing
  // the message.
  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
  const expectedServerSignature = createHmac('sha256', serverKey)
    .update(authMessage)
    .digest('base64');

  return {
    clientFirstBare,
    clientFinal: `${clientFinalWithoutProof},p=${proof.toString('base64')}`,
    expectedServerSignature
  };
}

function parseAuthMessage(body) {
  return {
    type: body.readInt32BE(0),
    salt: body.subarray(4, 8)
  };
}

/** Walks a SCRAM exchange and returns the final server signature, verified. */
function verifyScram(body, state) {
  const text = body.toString('utf8');
  const attrs = Object.fromEntries(
    text.split(',').map(part => {
      const eq = part.indexOf('=');
      return [part.slice(0, eq), part.slice(eq + 1)];
    })
  );

  const { clientFinal, expectedServerSignature } = scramClientProof({
    password: state.password,
    username: state.username,
    clientNonce: state.clientNonce,
    serverFirst: state.serverFirst
  });

  if (attrs.e) {
    throw new Error(`SCRAM authentication failed: ${attrs.e}`);
  }
  if (attrs.v !== expectedServerSignature) {
    // Reaching here means the server proved nothing, or proved the wrong thing.
    throw new Error('SCRAM server signature mismatch');
  }
  return clientFinal;
}

// ─── Result parsing ──────────────────────────────────────────────────────────

/** ErrorResponse fields are (byte code, value) pairs terminated by a zero byte. */
export function parseErrorResponse(body) {
  const fields = {};
  for (let i = 0; i < body.length - 1; ) {
    const code = String.fromCharCode(body[i]);
    if (code === '\0') break;
    const end = body.indexOf(0, i + 1);
    fields[code] = body.toString('utf8', i + 1, end);
    i = end + 1;
  }
  return { severity: fields.S, code: fields.C, message: fields.M, detail: fields.D };
}

/**
 * RowDescription: int16 field count, then a name-terminated descriptor per field.
 *
 * Every read is bounds-checked. A short or corrupt buffer would otherwise make
 * `indexOf` return -1, which pins `offset` in place and spins forever appending
 * descriptors -- an OOM in a restore check is a far worse failure mode than a
 * thrown error.
 */
export function parseRowDescription(body) {
  if (body.length < 2) throw new Error('RowDescription is too short to hold a field count');
  const count = body.readInt16BE(0);
  if (count < 0) throw new Error(`RowDescription has a negative field count: ${count}`);

  const fields = [];
  let offset = 2;

  for (let i = 0; i < count; i += 1) {
    const end = body.indexOf(0, offset);
    if (end === -1) {
      throw new Error(`RowDescription field ${i} has no terminating null byte`);
    }
    const name = body.toString('utf8', offset, end);
    // name\0 + tableOID(4) + colNum(2) + typeOID(4) + typeLen(2) + typeMod(4) + format(2)
    if (end + 1 + 4 + 2 + 4 > body.length) {
      throw new Error(`RowDescription field ${i} (${name}) is truncated`);
    }
    const typeOid = body.readInt32BE(end + 1 + 4 + 2);
    fields.push({ name, typeOid });
    offset = end + 1 + 4 + 2 + 4 + 2 + 4 + 2;
  }
  return fields;
}

/** DataRow: int16 column count, then int32-length-prefixed values, -1 for NULL. */
export function parseDataRow(body, fields) {
  if (body.length < 2) throw new Error('DataRow is too short to hold a column count');
  const count = body.readInt16BE(0);
  if (count < 0) throw new Error(`DataRow has a negative column count: ${count}`);

  const values = [];
  let offset = 2;

  for (let i = 0; i < count; i += 1) {
    if (offset + 4 > body.length) {
      throw new Error(`DataRow column ${i} has no length prefix`);
    }
    const length = body.readInt32BE(offset);
    offset += 4;
    if (length === -1) {
      values.push(null);
      continue;
    }
    if (length < 0) throw new Error(`DataRow column ${i} has an invalid length: ${length}`);
    if (offset + length > body.length) {
      throw new Error(`DataRow column ${i} claims ${length} bytes but only ${body.length - offset} remain`);
    }
    values.push(body.toString('utf8', offset, offset + length));
    offset += length;
  }

  if (fields) {
    return Object.fromEntries(fields.map((f, i) => [f.name, values[i] ?? null]));
  }
  return values;
}

// ─── Connection ──────────────────────────────────────────────────────────────

class Connection {
  constructor(socket, reader) {
    this.socket = socket;
    this.reader = reader;
  }

  send(buffer) {
    this.socket.write(buffer);
  }

  async _readUntil(predicate) {
    for (;;) {
      const message = await this.reader.next();
      if (predicate(message)) return message;
    }
  }

  /** Resolves once the server reports ReadyForQuery, i.e. it is idle and usable. */
  async _authenticate(params) {
    const state = {
      password: params.password,
      username: params.user,
      clientNonce: randomBytes(18).toString('base64')
    };
    let mechanisms = null;

    for (;;) {
      const { tag, body } = await this.reader.next();

      if (tag === 'E') throw new Error(formatPgError(parseErrorResponse(body)));
      if (tag !== 'R') {
        // 'S' ParameterStatus and 'K' BackendKeyData are informational here.
        if (tag === 'Z') return;
        continue;
      }

      const { type, salt } = parseAuthMessage(body);

      if (type === 0) {
        // AuthenticationOk. The session may still be in startup; keep reading.
        continue;
      }

      if (type === 3) {
        this.send(tagged('p', cstring(params.password)));
        continue;
      }

      if (type === 5) {
        this.send(tagged('p', cstring(md5Password(params.user, params.password, salt))));
        continue;
      }

      if (type === 10) {
        // SASL: int32 mechanism count, then null-terminated mechanism names.
        let offset = 4;
        const available = [];
        for (;;) {
          const end = body.indexOf(0, offset);
          if (end === offset) break;
          available.push(body.toString('utf8', offset, end));
          offset = end + 1;
        }
        mechanisms = available;

        if (!available.includes('SCRAM-SHA-256')) {
          throw new Error(
            `server offered SASL mechanisms ${available.join(', ')}; only SCRAM-SHA-256 is supported`
          );
        }

        // The bare message is retained because it is part of the authentication
        // message the server signs.
        const clientFirstBare = scramClientFirstBare(state.username, state.clientNonce);
        const clientFirst = `n,,${clientFirstBare}`;

        const mechanism = cstring('SCRAM-SHA-256');
        const initial = Buffer.alloc(4);
        initial.writeInt32BE(clientFirst.length, 0);
        const payload = Buffer.concat([mechanism, initial, Buffer.from(clientFirst, 'utf8')]);

        this.send(tagged('p', payload));
        continue;
      }

      if (type === 11) {
        state.serverFirst = body.toString('utf8', 4);
        this.send(tagged('p', Buffer.from(verifyScram(body, state), 'utf8')));
        continue;
      }

      if (type === 12) {
        verifyScram(body, state);
        continue;
      }

      throw new Error(`unsupported authentication method ${type}${mechanisms ? '' : ''}`);
    }
  }

  /** Runs a simple query and returns its rows as objects keyed by column name. */
  async query(sql) {
    this.send(tagged('Q', cstring(sql)));

    let fields = null;
    const rows = [];

    for (;;) {
      const { tag, body } = await this.reader.next();

      if (tag === 'T') {
        fields = parseRowDescription(body);
        continue;
      }
      if (tag === 'D') {
        rows.push(parseDataRow(body, fields));
        continue;
      }
      if (tag === 'E') {
        throw new Error(formatPgError(parseErrorResponse(body)));
      }
      if (tag === 'Z') {
        return { rows, fields: fields ?? [] };
      }
    }
  }

  end() {
    // Terminate ('X') is a bare tag with no payload.
    try {
      this.send(tagged('X', Buffer.alloc(0)));
    } catch {
      // The socket may already be gone; nothing useful to do.
    }
    this.socket.destroy();
  }
}

function formatPgError({ severity, code, message, detail }) {
  return [
    severity ? `${severity}` : 'ERROR',
    code ? `(${code})` : '',
    message || 'unknown error',
    detail || ''
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Connects, negotiates TLS and authenticates.
 *
 * The server certificate is not verified. RDS presents a certificate from the
 * Amazon RDS CA bundle, which is not in Node's trust store, and embedding the
 * bundle would put a large blob in this repository. The connection is still
 * encrypted, and the peer is authenticated by the RDS endpoint's DNS name
 * resolving to a private address inside our VPC.
 */
export async function connect({ host, port = 5432, user, password, database }) {
  const raw = await new Promise((resolve, reject) => {
    const socket = netConnect({ host, port }, () => resolve(socket));
    socket.setTimeout(15000, () => {
      socket.destroy(new Error(`timed out connecting to ${host}:${port}`));
    });
    socket.once('error', reject);
  });

  const reader = new MessageStream();
  raw.on('data', chunk => reader.push(chunk));
  raw.once('error', err => reader.failure = reader.failure || err);

  // SSLRequest: an 8-byte packet with no tag, then a single byte answer.
  const sslRequest = Buffer.alloc(8);
  sslRequest.writeInt32BE(8, 0);
  sslRequest.writeInt32BE(SSL_REQUEST_CODE, 4);
  raw.write(sslRequest);

  const answer = await new Promise((resolve, reject) => {
    raw.once('data', resolve);
    raw.once('error', reject);
    raw.once('end', () => reject(new Error('server closed before the SSL negotiation')));
  });

  if (answer[0] !== 0x53 /* 'S' */) {
    raw.destroy();
    throw new Error('server refused TLS; RDS requires it');
  }

  const socket = tlsConnect(
    { socket: raw, servername: host, rejectUnauthorized: false },
    () => {
      socket.removeAllListeners('data');
      socket.on('data', chunk => reader.push(chunk));
      socket.once('error', err => {
        reader.failure = reader.failure || err;
      });
    }
  );

  const connection = new Connection(socket, reader);
  socket.write(
    startupMessage({
      user,
      database,
      application_name: 'vesting-backup-verify',
      client_encoding: 'UTF8'
    })
  );

  await connection._authenticate({ user, password });
  return connection;
}
