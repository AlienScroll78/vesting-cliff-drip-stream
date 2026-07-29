import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const API_SPEC_PATH = path.resolve(process.cwd(), 'docs/api.yaml');

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

  if (!spec.openapi || !spec.openapi.startsWith('3.')) {
    console.error('Error: Invalid or missing openapi version (expected 3.x)');
    process.exit(1);
  }

  const requiredPaths = [
    '/health',
    '/health/horizon',
    '/health/horizon/circuit-breaker',
    '/api/openapi.json',
    '/api/v1/admin/drain'
  ];

  for (const pathName of requiredPaths) {
    if (!spec.paths || !spec.paths[pathName]) {
      console.error(`Error: Required path "${pathName}" missing from OpenAPI spec.`);
      process.exit(1);
    }
  }

  console.log('OpenAPI spec validation passed: docs/api.yaml is valid.');
}

validateSpec();
