"use strict";

const { pool } = require("../db");
const { authMiddleware } = require("./auth");

async function optOutHandler(req, res) {
  const sponsor = req.user?.address;
  if (!sponsor) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let body = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", resolve);
  });

  let { opt_out } = {};
  try {
    ({ opt_out } = JSON.parse(body));
  } catch {
    res.status(400).json({ error: "invalid JSON" });
    return;
  }

  if (typeof opt_out !== "boolean") {
    res.status(400).json({ error: "opt_out must be a boolean" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(
      "UPDATE streams SET notify_opt_out = $1 WHERE sponsor = $2",
      [opt_out, sponsor],
    );
    res.json({ ok: true, opt_out });
  } catch (err) {
    res.status(500).json({ error: String(err.message ?? err) });
  } finally {
    client.release();
  }
}

module.exports = { authMiddleware, optOutHandler };
