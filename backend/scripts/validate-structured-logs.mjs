import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [
  '--import', 'tsx',
  '--input-type=module',
  '--eval', `
    import { logger, runWithIds } from './src/logger.js';
    runWithIds({ requestId: 'json-lint', correlationId: '123e4567-e89b-42d3-a456-426614174000' }, () => {
      logger.info({ duration_ms: 1 }, 'structured-json-lint');
    });
  `,
], {
  cwd: backendDirectory,
  encoding: 'utf8',
  env: { ...process.env, LOG_LEVEL: 'info', LOG_PRETTY: 'false' },
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const line = result.stdout.split('\n').find((entry) => entry.includes('structured-json-lint'));
if (!line) throw new Error('Logger did not emit the validation record');

const record = JSON.parse(line);
for (const field of ['correlation_id', 'level', 'timestamp', 'service', 'message', 'duration_ms']) {
  if (!(field in record)) throw new Error(`Structured log is missing ${field}`);
}