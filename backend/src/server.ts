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

const PORT = parseInt(process.env.PORT ?? "3001", 10);
app.listen(PORT, () => {
  console.log(`[server] Active network: ${networkConfig.network}`);
  console.log(`[server] RPC: ${networkConfig.rpcUrl}`);
  console.log(`[server] Listening on :${PORT}`);
});

// Start background jobs and admin server
scheduleCleanupJob();
startAdminServer();
