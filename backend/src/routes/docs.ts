/**
 * Serves Swagger UI at GET /api/docs
 *
 * The UI is served inline (no npm dependency on swagger-ui-express) by
 * loading the OpenAPI spec from the filesystem and rendering it via the
 * Swagger UI CDN bundle. This avoids adding a heavy dev dependency to the
 * production Docker image.
 *
 * The spec file is resolved relative to the repo root so it works both
 * locally (running from backend/) and in Docker (COPY'd to /app/docs/).
 */

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve spec path: try repo-root docs/api/openapi.yaml, then fall back to
// a path relative to this file so tests / Docker both work.
const SPEC_CANDIDATES = [
  path.resolve(__dirname, "../../docs/api/openapi.yaml"),
  path.resolve(__dirname, "../../../docs/api/openapi.yaml"),
];

function findSpecPath(): string | null {
  for (const p of SPEC_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const router = Router();

/**
 * GET /api/docs
 * Renders Swagger UI with the bundled OpenAPI spec.
 */
router.get("/", (_req: Request, res: Response) => {
  const specPath = findSpecPath();
  if (!specPath) {
    res.status(503).send("OpenAPI spec not found. Run `make docs` to generate it.");
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
      url: "/api/docs/openapi.yaml",
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
 * GET /api/docs/openapi.yaml
 * Serves the raw OpenAPI YAML spec so Swagger UI can fetch it.
 */
router.get("/openapi.yaml", (_req: Request, res: Response) => {
  const specPath = findSpecPath();
  if (!specPath) {
    res.status(503).json({ error: "OpenAPI spec not found" });
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
