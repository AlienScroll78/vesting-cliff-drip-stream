import express from "express";
import { networkConfig } from "./config/network.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import { scheduleCleanupJob } from "./jobs/streamCleanup.js";
import { startAdminServer } from "./admin/server.js";

const app = express();
app.use(express.json());

// Apply idempotency middleware to mutating endpoints
app.use(["/api/streams", "/api/claim", "/api/cancel"], idempotencyMiddleware);

// Public API routes (placeholder)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", network: networkConfig.network });
});

const PORT = parseInt(process.env.PORT ?? "3001", 10);
app.listen(PORT, () => {
  console.log(`[server] Active network: ${networkConfig.network}`);
  console.log(`[server] RPC: ${networkConfig.rpcUrl}`);
  console.log(`[server] Listening on :${PORT}`);
});

// Start background jobs and admin server
scheduleCleanupJob();
startAdminServer();
