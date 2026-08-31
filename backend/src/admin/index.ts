/**
 * Admin API router.
 *
 * Mounts all admin sub-routers under the /admin prefix and enforces Bearer
 * token authentication on every request.
 *
 * Mount this in app.ts / server.js:
 *
 *   import { adminRouter } from "./admin/index.js";
 *   app.use("/admin", adminRouter);
 *
 * All requests MUST supply a valid Bearer token:
 *   Authorization: Bearer <ADMIN_API_KEY>
 *
 * Routes exposed:
 *   GET  /admin/streams
 *   GET  /admin/indexer/status
 *   POST /admin/indexer/restart
 *   GET  /admin/webhooks/dlq
 *   POST /admin/webhooks/dlq/replay
 */

import { Router } from "express";
import { requireAdminAuth } from "./auth.js";
import { streamsRouter } from "./streams.js";
import { indexerRouter } from "./indexer.js";
import { webhooksRouter } from "./webhooks.js";

export const adminRouter = Router();

// Apply authentication to every admin route.
adminRouter.use(requireAdminAuth);

// Mount sub-routers.
adminRouter.use("/streams", streamsRouter);
adminRouter.use("/indexer", indexerRouter);
adminRouter.use("/webhooks", webhooksRouter);
