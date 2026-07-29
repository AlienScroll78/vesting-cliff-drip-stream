import http from "http";
import express from "express";
import { networkConfig } from "./config/network.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { scheduleCleanupJob } from "./jobs/streamCleanup.js";
import { startAdminServer } from "./admin/server.js";
import { healthHandler, readyHandler } from "./routes/health.js";
import { sponsorAnalyticsHandler } from "./routes/analytics.js";

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

// Issue #26 — REST API for vesting schedule queries
app.use("/api", vestingRouter);

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

// Start background jobs and admin server
scheduleCleanupJob();
startAdminServer();

// Issue #27 — Start event indexer (only if DATABASE_URL is set)
if (process.env.DATABASE_URL) {
  startIndexer();
} else {
  console.warn("[indexer] DATABASE_URL not set — indexer disabled");
}
