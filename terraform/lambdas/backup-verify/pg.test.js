import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  md5Password,
  scramClientProof,
  scramClientFirstBare,
  parseErrorResponse,
  parseRowDescription,
  parseDataRow
} from './pg.js';

// Builds a message *body* (no tag, no length) for a tagged message. The parsers
// take the body because MessageStream strips the tag and length before handing
// them over.
function messageBody(fields) {
  const parts = [];
  for (const field of fields) {
    if (typeof field === 'number') {
      const b = Buffer.alloc(2);
      b.writeInt16BE(field, 0);
      parts.push(b);
      continue;
    }
    const name = Buffer.from(field, 'utf8');
    const rest = Buffer.alloc(18); // tableOID(4) colNum(2) typeOID(4) typeLen(2) typeMod(4) format(2)
    parts.push(Buffer.concat([name, Buffer.from([0]), rest]));
  }
  return Buffer.concat(parts);
}

describe('md5Password', () => {
  test('produces md5 + the hex digest, using the username as salt', () => {
    const result = md5Password('vesting', 'pencil', Buffer.from('salt', 'utf8'));
    assert.match(result, /^md5[0-9a-f]{32}$/);
  });

  test('changes with the username, password and salt', () => {
    const salt = Buffer.from('salt', 'utf8');
    const base = md5Password('vesting', 'pencil', salt);
    assert.notEqual(base, md5Password('other', 'pencil', salt));
    assert.notEqual(base, md5Password('vesting', 'other', salt));
    assert.notEqual(base, md5Password('vesting', 'pencil', Buffer.from('pepper', 'utf8')));
  });

  // Postgres salts are four raw bytes, not text. Interpolating the buffer into
  // a string decodes it as UTF-8 and mangles every byte above 0x7f, so this
  // pins the byte-exact digest rather than just the shape of it.
  test('hashes a non-UTF-8 salt byte for byte', () => {
    const salt = Buffer.from([0xff, 0x00, 0x80, 0x7f]);
    assert.equal(md5Password('vesting', 'pencil', salt), 'md5aae7aa3d0dcbe34e41a76018219f16c1');
  });
});

describe('scramClientProof', () => {
  // RFC 7677 section 3. Working through this vector is the only real check that
  // the proof, the auth message ordering and the server signature all line up.
  // The vector's user is "user" -- the username is part of the signed auth
  // message, so it cannot be varied away.
  const serverFirst =
    'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,' +
    's=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
  const clientNonce = 'rOprNGfwEbeRWgbNEkqO';

  const vector = { password: 'pencil', username: 'user', clientNonce, serverFirst };

  test('builds the client-first-message-bare from the username', () => {
    assert.equal(
      scramClientFirstBare('user', clientNonce),
      'n=user,r=rOprNGfwEbeRWgbNEkqO'
    );
  });

  test('escapes the reserved characters in the username', () => {
    assert.equal(scramClientFirstBare('a,b=c', 'nonce'), 'n=a=2Cb=3Dc,r=nonce');
  });

  test('matches the RFC 7677 client proof', () => {
    const { clientFinal } = scramClientProof(vector);

    assert.equal(
      clientFinal,
      'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,' +
        'p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ='
    );
  });

  test('matches the RFC 7677 server signature', () => {
    const { expectedServerSignature } = scramClientProof(vector);
    assert.equal(expectedServerSignature, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  });

  test('rejects a server nonce that does not extend the client nonce', () => {
    assert.throws(
      () =>
        scramClientProof({
          ...vector,
          serverFirst: 'r=totallyDifferent,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096'
        }),
      /does not extend/
    );
  });

  test('rejects a nonsense iteration count rather than hanging on pbkdf2', () => {
    assert.throws(
      () =>
        scramClientProof({
          ...vector,
          serverFirst: `r=${clientNonce}x,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=zero`
        }),
      /iteration count/
    );
  });
});

describe('parseErrorResponse', () => {
  test('reads the severity, code and message out of a field list', () => {
    const body = Buffer.concat([
      Buffer.from('S'), Buffer.from('FATAL\0'),
      Buffer.from('C'), Buffer.from('28000\0'),
      Buffer.from('M'), Buffer.from('no pg_hba.conf entry for host "10.0.0.1"\0'),
      Buffer.from([0])
    ]);

    const parsed = parseErrorResponse(body);
    assert.equal(parsed.severity, 'FATAL');
    assert.equal(parsed.code, '28000');
    assert.match(parsed.message, /no pg_hba\.conf entry/);
  });
});

describe('row parsing', () => {
  test('reads a three-column RowDescription', () => {
    const body = messageBody([3, 'count', 'table_name', 'schema_version']);

    const fields = parseRowDescription(body);
    assert.deepEqual(fields.map(f => f.name), ['count', 'table_name', 'schema_version']);
  });

  test('turns a DataRow into an object keyed by column name', () => {
    const fields = [
      { name: 'count', typeOid: 20 },
      { name: 'table_name', typeOid: 25 }
    ];

    const body = Buffer.concat([
      (() => {
        const b = Buffer.alloc(2);
        b.writeInt16BE(2, 0);
        return b;
      })(),
      (() => {
        const b = Buffer.alloc(4);
        b.writeInt32BE(1, 0);
        return Buffer.concat([b, Buffer.from('1', 'utf8')]);
      })(),
      (() => {
        const b = Buffer.alloc(4);
        b.writeInt32BE(6, 0);
        return Buffer.concat([b, Buffer.from('claims', 'utf8')]);
      })()
    ]);

    assert.deepEqual(parseDataRow(body, fields), { count: '1', table_name: 'claims' });
  });

  test('represents a NULL column as null, not the string -1', () => {
    const fields = [{ name: 'note', typeOid: 25 }];

    const header = Buffer.alloc(2);
    header.writeInt16BE(1, 0);
    const nullLen = Buffer.alloc(4);
    nullLen.writeInt32BE(-1, 0);

    assert.deepEqual(parseDataRow(Buffer.concat([header, nullLen]), fields), { note: null });
  });

  test('handles multi-byte UTF-8 by using byte lengths', () => {
    const fields = [{ name: 'recipient', typeOid: 25 }];
    const value = Buffer.from('GABC…é中', 'utf8');

    const header = Buffer.alloc(2);
    header.writeInt16BE(1, 0);
    const len = Buffer.alloc(4);
    len.writeInt32BE(value.length, 0);

    assert.deepEqual(
      parseDataRow(Buffer.concat([header, len, value]), fields),
      { recipient: 'GABC…é中' }
    );
  });

  // Regression: a short buffer used to make indexOf return -1, which left
  // `offset` unchanged and spun forever growing an array until the process
  // died. These bodies are the ones that used to hang the test runner.
  test('rejects a RowDescription with an unterminated field name', () => {
    const noTerminator = Buffer.concat([Buffer.from([0, 3]), Buffer.from('count', 'utf8')]);
    assert.throws(() => parseRowDescription(noTerminator), /terminating null/);
  });

  test('rejects a RowDescription whose descriptor is cut short', () => {
    // count=1, then "a\0" but only two of the eighteen descriptor bytes.
    const cutShort = Buffer.concat([Buffer.from([0, 1]), Buffer.from('a\0', 'utf8'), Buffer.alloc(2)]);
    assert.throws(() => parseRowDescription(cutShort), /truncated/);
  });

  test('rejects a DataRow whose length prefix runs off the end', () => {
    const header = Buffer.alloc(2);
    header.writeInt16BE(1, 0);
    const len = Buffer.alloc(4);
    len.writeInt32BE(99, 0);
    assert.throws(
      () => parseDataRow(Buffer.concat([header, len, Buffer.from('abc')]), [{ name: 'x' }]),
      /only 3 remain/
    );
  });
});
