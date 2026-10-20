import http from "http";
import express, { Router } from "express";
import { networkConfig } from "./config/network.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { scheduleCleanupJob } from "./jobs/streamCleanup.js";
import { startAdminServer } from "./admin/server.js";
import { healthHandler, readyHandler } from "./routes/health.js";
import { sponsorAnalyticsHandler } from "./routes/analytics.js";
import { validate } from "./middleware/validate.js";
import { AddressParamsSchema } from "./validation.js";
import { docsRouter } from "./routes/docs.js";
// Issue #742 — JWT auth v2 (RS256 + RBAC)
import {
  challengeHandler,
  tokenHandler,
  refreshHandler,
  jwksHandler,
} from "./routes/authV2.js";
import { adminContractRouter } from "./routes/adminContract.js";
import { initKeyStore } from "./auth/keyStore.js";
// Issue #26 — REST API for vesting schedule queries
import { vestingRouter } from "./routes/vesting.js";
// Issue #28 — WebSocket endpoint for real-time claimable updates
import { attachWebSocketServer } from "./ws.js";

// Initialise RSA key store on startup
initKeyStore();

const app = express();
app.use(express.json());

// Issue #1006 — GET /docs serves Swagger UI from api/openapi.yaml
// (non-production only; mounted before rate limiting so the UI loads freely).
app.use(docsRouter);

// Rate limiting on all public routes (#32)
app.use(rateLimitMiddleware);

// Apply idempotency middleware to mutating endpoints
app.use(
  ["/api/streams", "/api/claim", "/api/cancel", "/api/v1/streams", "/api/v1/claim", "/api/v1/cancel"],
  idempotencyMiddleware,
);

// Health / readiness probes (#35)
app.get("/health", healthHandler);
app.get("/ready", readyHandler);

// Analytics (#34)
app.get("/analytics/sponsor/:address", validate({ params: AddressParamsSchema }), sponsorAnalyticsHandler);

// Issue #742 — Auth endpoints (RS256 JWT + Stellar wallet signature)
app.post("/api/auth/challenge", challengeHandler);
app.post("/api/auth/token", tokenHandler);
app.post("/api/auth/refresh", refreshHandler);
// JWKS endpoint for public-key discovery
app.get("/.well-known/jwks.json", jwksHandler);

// Issue #742 — Protected admin contract endpoints (require admin JWT)
app.use("/api/admin", adminContractRouter);

// Issue #26 — REST API for vesting schedule queries
app.use("/api", vestingRouter);

// Issue #1006 — Canonical versioned API surface. The /api/v1 mount is the
// surface documented by api/openapi.yaml; the legacy unversioned mounts
// above remain for backwards compatibility.
const apiV1Router = Router();
apiV1Router.post("/auth/challenge", challengeHandler);
apiV1Router.post("/auth/token", tokenHandler);
apiV1Router.post("/auth/refresh", refreshHandler);
apiV1Router.use("/admin", adminContractRouter);
apiV1Router.use("/", vestingRouter);
app.use("/api/v1", apiV1Router);

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const httpServer = http.createServer(app);

// Issue #28 — WebSocket endpoint for real-time claimable updates
attachWebSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`[server] Active network: ${networkConfig.network}`);
  console.log(`[server] RPC: ${networkConfig.rpcUrl}`);
  console.log(`[server] Listening on :${PORT}`);
  console.log(`[server] WebSocket: ws://0.0.0.0:${PORT}/ws/claimable`);
});
