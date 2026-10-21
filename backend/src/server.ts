import http from "http";
import express from "express";
import { networkConfig } from "./config/network.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { healthHandler, readyHandler } from "./routes/health.js";
import { sponsorAnalyticsHandler } from "./routes/analytics.js";
// Issue #742 — JWT auth v2 (RS256 + RBAC)
import {
  challengeHandler,
  tokenHandler,
  refreshHandler,
  jwksHandler,
} from "./routes/authV2.js";
import { adminContractRouter } from "./routes/adminContract.js";
import { vestingRouter } from "./routes/vesting.js";
import { attachWebSocketServer } from "./ws.js";
import { initKeyStore } from "./auth/keyStore.js";
import { runMigrationsOrExit } from "./migrate.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

/**
 * Issue #1013 — bootstrap.
 *
 * Migrations run to completion *before* `listen()`, so the HTTP server never
 * accepts traffic against a stale schema. `runMigrationsOrExit` aborts the
 * process with a non-zero exit code if the schema could not be brought up to
 * date, which stops a bad deploy from rolling forward.
 *
 * In a multi-replica rollout each replica calls this concurrently; the
 * PostgreSQL advisory lock inside the runner means only one applies migrations
 * while the others observe a current schema and continue to boot.
 */
async function main(): Promise<void> {
  await runMigrationsOrExit();

  // Initialise RSA key store on startup
  initKeyStore();

  const app = express();
  app.use(express.json());

  // Rate limiting on all public routes (#32)
  app.use(rateLimitMiddleware);

  // Apply idempotency middleware to mutating endpoints
  app.use(["/api/streams", "/api/claim", "/api/cancel"], idempotencyMiddleware);

  // Health / readiness probes (#35)
  app.get("/health", healthHandler);
  app.get("/ready", readyHandler);

  // Analytics (#34)
  app.get("/analytics/sponsor/:address", sponsorAnalyticsHandler);

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

  const httpServer = http.createServer(app);

  // Issue #28 — WebSocket endpoint for real-time claimable updates
  attachWebSocketServer(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`[server] Active network: ${networkConfig.network}`);
    console.log(`[server] RPC: ${networkConfig.rpcUrl}`);
    console.log(`[server] Listening on :${PORT}`);
    console.log(`[server] WebSocket: ws://0.0.0.0:${PORT}/ws/claimable`);
  });
}

main().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
