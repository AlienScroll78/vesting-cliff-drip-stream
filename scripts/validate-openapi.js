import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const API_SPEC_PATH = path.resolve(process.cwd(), 'api/openapi.yaml');

// ---------------------------------------------------------------------------
// Issue #1006: api/openapi.yaml is the source of truth for the backend REST
// API. This script enforces its structural completeness in CI:
//   1. parses as YAML with openapi 3.0.x,
//   2. documents every endpoint of the backend service,
//   3. every operation has a unique operationId and a success response,
//   4. every operation documents the error responses it can produce,
//   5. the reusable component schemas and security schemes exist.
// ---------------------------------------------------------------------------

const REQUIRED_PATHS = [
  '/health',
  '/ready',
  '/.well-known/jwks.json',
  '/docs',
  '/docs/openapi.yaml',
  '/analytics/sponsor/{address}',
  '/api/v1/auth/challenge',
  '/api/v1/auth/token',
  '/api/v1/auth/refresh',
  '/api/v1/schedules/{recipient}',
  '/api/v1/claimable/{recipient}',
  '/api/v1/schedules/sponsor/{sponsor}',
  '/api/v1/admin/set_min_deposit',
  '/api/v1/admin/pause_stream',
];

// Status codes that must be documented per operation (acceptance criterion:
// error responses documented for each endpoint).
const REQUIRED_ERROR_RESPONSES = {
  'GET /health': ['429', '503'],
  'GET /ready': ['429', '503'],
  'GET /.well-known/jwks.json': ['429'],
  'GET /docs': ['404', '503'],
  'GET /docs/openapi.yaml': ['404', '500', '503'],
  'GET /analytics/sponsor/{address}': ['400', '429', '500'],
  'POST /api/v1/auth/challenge': ['400', '429', '500'],
  'POST /api/v1/auth/token': ['400', '401', '429', '500'],
  'POST /api/v1/auth/refresh': ['400', '401', '429', '500'],
  'GET /api/v1/schedules/{recipient}': ['400', '404', '429', '500'],
  'GET /api/v1/claimable/{recipient}': ['400', '429', '500'],
  'GET /api/v1/schedules/sponsor/{sponsor}': ['400', '429', '500', '502'],
  'POST /api/v1/admin/set_min_deposit': ['400', '401', '403', '429', '500', '502'],
  'POST /api/v1/admin/pause_stream': ['400', '401', '403', '429', '500', '502'],
};

const REQUIRED_SCHEMAS = ['Stream', 'StreamEvent', 'Balance', 'Error'];

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function validateSpec() {
  if (!fs.existsSync(API_SPEC_PATH)) {
    console.error(`Error: Spec file not found at ${API_SPEC_PATH}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(API_SPEC_PATH, 'utf8');
  let spec;
  try {
    spec = yaml.parse(fileContent);
  } catch (err) {
    console.error(`Error: Failed to parse YAML at ${API_SPEC_PATH}:`, err.message);
    process.exit(1);
  }

  const failures = [];

  if (!spec.openapi || !spec.openapi.startsWith('3.0')) {
    failures.push(`Invalid or missing openapi version (expected 3.0.x, got ${spec.openapi})`);
  }

  if (!spec.info?.title) failures.push('Missing info.title');
  if (!spec.info?.version) failures.push('Missing info.version');

  // Required paths
  for (const pathName of REQUIRED_PATHS) {
    if (!spec.paths?.[pathName]) {
      failures.push(`Required path "${pathName}" missing from OpenAPI spec.`);
    }
  }

  // Per-operation checks
  const operationIds = new Set();
  const operations = [];
  for (const [pathName, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      const key = `${method.toUpperCase()} ${pathName}`;
      operations.push(key);

      if (!operation.operationId) {
        failures.push(`${key}: missing operationId`);
      } else if (operationIds.has(operation.operationId)) {
        failures.push(`${key}: duplicate operationId "${operation.operationId}"`);
      } else {
        operationIds.add(operation.operationId);
      }

      const hasSuccess = Object.keys(operation.responses ?? {}).some((code) =>
        /^[23]/.test(code),
      );
      if (!hasSuccess) {
        failures.push(`${key}: no 2xx/3xx success response documented`);
      }

      for (const status of REQUIRED_ERROR_RESPONSES[key] ?? []) {
        if (!operation.responses?.[status]) {
          failures.push(`${key}: missing documented error response ${status}`);
        }
      }
    }
  }

  // Every documented error map entry must correspond to a real operation
  for (const key of Object.keys(REQUIRED_ERROR_RESPONSES)) {
    if (!operations.includes(key)) {
      failures.push(`Required operation "${key}" missing from OpenAPI spec.`);
    }
  }

  // Reusable component schemas (issue acceptance criterion)
  for (const schemaName of REQUIRED_SCHEMAS) {
    if (!spec.components?.schemas?.[schemaName]) {
      failures.push(`Required component schema "${schemaName}" missing.`);
    }
  }

  if (!spec.components?.securitySchemes?.bearerAuth) {
    failures.push('Required security scheme "bearerAuth" missing.');
  }

  if (failures.length > 0) {
    console.error(`OpenAPI spec validation FAILED (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
    for (const failure of failures) {
      console.error(`  • ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `OpenAPI spec validation passed (${operations.length} operations across ${REQUIRED_PATHS.length} paths).`,
  );
}

validateSpec();
