"use strict";

const express = require("express");
const { requestIdMiddleware } = require("./middleware/requestId");
const { challengeHandler, tokenHandler, authMiddleware } = require("./routes/auth");
const { exportSponsorHandler } = require("./routes/export");
const { optOutHandler } = require("./routes/optOut");
const { startAdminServer } = require("./admin/server.ts");
const { scheduleNotificationJob } = require("./jobs/notificationJob.js");

const app = express();
app.use(express.json());
app.use(requestIdMiddleware);

app.get("/auth/challenge", challengeHandler);
app.post("/auth/token", tokenHandler);

app.get("/export/sponsor/:address", authMiddleware, exportSponsorHandler);
app.post("/notify/opt-out", authMiddleware, optOutHandler);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`[server] Public API listening on 0.0.0.0:${PORT}`);
  startAdminServer();
  scheduleNotificationJob();
});
