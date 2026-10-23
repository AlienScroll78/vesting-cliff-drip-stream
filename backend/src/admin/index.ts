/**
 * Admin API router.
 *
 * Mounts all admin sub-routers under the /admin prefix and enforces JWT
 * bearer authentication on every request (issue #1003).
 *
 * Mount this in app.ts / server.js:
 *
 *   import { adminRouter } from "./admin/index.js";
 *   app.use("/admin", adminRouter);
 *
 * All requests MUST supply a valid RS256 JWT with role='admin':
 *   Authorization: Bearer <access_token>
 *
 * Tokens are issued by POST /api/auth/token (Stellar wallet signature flow)
 * and refreshed via POST /api/auth/refresh. Error contract:
 *   missing/invalid token → 401 { error: "Unauthorized" }
 *   expired token         → 401 { error: "TokenExpired" }
 *   non-admin role        → 403 { error: "Forbidden: insufficient role" }
 *
 * Routes exposed:
 *   GET  /admin/streams
 *   GET  /admin/indexer/status
 *   POST /admin/indexer/restart
 *   GET  /admin/webhooks/dlq
 *   POST /admin/webhooks/dlq/replay
 *   POST /admin/backfill?from_ledger=N&to_ledger=M  (Issue #749)
 *   GET  /admin/backfill                             (Issue #749)
 *   GET  /admin/backfill/:id                         (Issue #749)
 */

import { Router } from "express";
import { authMiddleware, requireRole } from "../routes/authV2.js";
import { streamsRouter } from "./streams.js";
import { indexerRouter } from "./indexer.js";
import { webhooksRouter } from "./webhooks.js";
import { backfillRouter } from "./backfill.js";
import { registry } from "../metrics.js";

export const adminRouter = Router();

// Apply JWT authentication and admin-role enforcement to every admin route.
adminRouter.use(authMiddleware, requireRole("admin"));

// Mount sub-routers.
adminRouter.use("/streams", streamsRouter);
adminRouter.use("/indexer", indexerRouter);
adminRouter.use("/webhooks", webhooksRouter);
adminRouter.use("/backfill", backfillRouter);
adminRouter.get("/metrics", async (_req, res) => {
	res.setHeader("Content-Type", registry.contentType);
	res.send(await registry.metrics());
});
