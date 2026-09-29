import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import yaml from 'yaml';
import swaggerUi from 'swagger-ui-express';
import * as OpenApiValidator from 'express-openapi-validator';

export function createApp(options = {}) {
  const app = express();
  const specPath = options.specPath || path.resolve(process.cwd(), 'docs/api.yaml');

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // In-flight & shutdown middleware
  if (options.inFlightMiddleware) {
    app.use(options.inFlightMiddleware);
  }
  if (options.shutdownCheckMiddleware) {
    app.use(options.shutdownCheckMiddleware);
  }

  let apiSpecJson = {};
  if (fs.existsSync(specPath)) {
    const apiSpecYaml = fs.readFileSync(specPath, 'utf8');
    apiSpecJson = yaml.parse(apiSpecYaml);
  }

  // Raw OpenAPI spec endpoint
  app.get('/api/openapi.json', (req, res) => {
    res.json(apiSpecJson);
  });

  // Swagger UI docs endpoint
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(apiSpecJson));

  // OpenAPI Request Validation Middleware
  if (fs.existsSync(specPath)) {
    app.use(
      OpenApiValidator.middleware({
        apiSpec: specPath,
        validateRequests: true,
        validateResponses: false,
        ignorePaths: /^\/api\/docs/
      })
    );
  }

  // Health endpoints
  app.get('/health', (req, res) => {
    if (options.getHealthHandler) {
      return options.getHealthHandler(req, res);
    }
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/health/horizon', (req, res) => {
    if (options.getHorizonHealthHandler) {
      return options.getHorizonHealthHandler(req, res);
    }
    res.json({ status: 'healthy', endpoints: ['http://127.0.0.1:8666'] });
  });

  app.get('/health/horizon/circuit-breaker', (req, res) => {
    if (options.getCircuitBreakerHandler) {
      return options.getCircuitBreakerHandler(req, res);
    }
    res.type('text/plain').send('closed');
  });

  // Admin drain endpoint
  app.post('/api/v1/admin/drain', (req, res, next) => {
    if (options.drainHandler) {
      return options.drainHandler(req, res, next);
    }
    const isDryRun = req.query.dry_run === 'true' || req.body?.dry_run === true;
    res.json({
      scanned: 0,
      eligible: 0,
      submitted: 0,
      dry_run: Boolean(isDryRun),
      streams: []
    });
  });

  // OpenAPI Error Handler
  app.use((err, req, res, next) => {
    if (err.status || err.statusCode || err.errors) {
      const status = err.status || err.statusCode || 400;
      return res.status(status).json({
        message: err.message || 'Validation error',
        errors: err.errors
          ? err.errors.map(e => ({
              path: e.path || e.instancePath || '',
              message: e.message || 'Invalid field'
            }))
          : [{ path: '', message: err.message }]
      });
    }
    next(err);
  });

  return app;
}

const defaultApp = createApp();
export default defaultApp;
