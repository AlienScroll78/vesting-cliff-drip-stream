/**
 * GET /docs               — Swagger UI (non-production environments only)
 * GET /docs/openapi.yaml  — raw OpenAPI spec backing the UI
 *
 * Issue #1006: `api/openapi.yaml` is the source of truth for the REST API.
 * The UI is served inline (no npm dependency on swagger-ui-express) by
 * loading the OpenAPI spec from the filesystem and rendering it via the
 * Swagger UI CDN bundle. In production (`NODE_ENV === "production"`) both
 * routes return 404, mirroring the GraphiQL gating in routes/graphql.js.
 *
 * The spec file is resolved relative to the repo root so it works both
 * locally (running from backend/) and in container images that copy the
 * repository to /app.
 */

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// api/openapi.yaml at the repo root (issue #1006), with a fallback for
// container layouts where the backend sits at the image root.
const SPEC_CANDIDATES = [
  path.resolve(__dirname, "../../../api/openapi.yaml"),
  path.resolve(__dirname, "../../api/openapi.yaml"),
];

function findSpecPath(): string | null {
  for (const p of SPEC_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

const router = Router();

/**
 * GET /docs
 * Renders Swagger UI with the bundled OpenAPI spec.
 */
router.get("/docs", (_req: Request, res: Response) => {
  if (isProduction()) {
    res.status(404).json({ error: "Not Found" });
    return;
  }

  const specPath = findSpecPath();
  if (!specPath) {
    res.status(503).json({ error: "OpenAPI spec not found: api/openapi.yaml is missing" });
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vesting Cliff Drip Stream — API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
<script>
  window.onload = function() {
    const ui = SwaggerUIBundle({
      url: "/docs/openapi.yaml",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: "StandaloneLayout",
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    });
    window.ui = ui;
  };
</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

/**
 * GET /docs/openapi.yaml
 * Serves the raw OpenAPI YAML spec so Swagger UI can fetch it.
 */
router.get("/docs/openapi.yaml", (_req: Request, res: Response) => {
  if (isProduction()) {
    res.status(404).json({ error: "Not Found" });
    return;
  }

  const specPath = findSpecPath();
  if (!specPath) {
    res.status(503).json({ error: "OpenAPI spec not found: api/openapi.yaml is missing" });
    return;
  }

  try {
    const content = fs.readFileSync(specPath, "utf-8");
    res.setHeader("Content-Type", "application/yaml; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(content);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read OpenAPI spec" });
  }
});

export { router as docsRouter };
