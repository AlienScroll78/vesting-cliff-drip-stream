"use strict";

const QueryStream = require("pg-query-stream");
const { pool } = require("../db");
const { createRedisClient } = require("../redisClient");

const EXPORT_RATE_KEY = "export_rate:";
const EXPORT_RATE_SECONDS = 60;
const EXPORT_COLUMNS = [
  "id",
  "sponsor",
  "recipient",
  "token",
  "rate_per_ledger",
  "cliff_ledger",
  "end_ledger",
  "status",
  "created_at",
  "updated_at",
];

function quoteCsv(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function exportSponsorHandler(req, res) {
  const sponsor = String(req.params.address || "");
  const authAddress = req.user?.address;

  if (!authAddress || authAddress !== sponsor) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const format = String(req.query.format || "json").toLowerCase();
  if (!["json", "csv"].includes(format)) {
    res.status(400).json({ error: "format must be csv or json" });
    return;
  }

  const redis = await createRedisClient();
  const rateKey = `${EXPORT_RATE_KEY}${sponsor}`;
  const existing = await redis.get(rateKey);
  if (existing) {
    res.status(429).json({ error: "Rate limit exceeded. Only one export per minute is allowed." });
    return;
  }
  await redis.set(rateKey, "1", { EX: EXPORT_RATE_SECONDS });

  const client = await pool.connect();
  try {
    const sql = `SELECT ${EXPORT_COLUMNS.join(", ")} FROM streams WHERE sponsor = $1 ORDER BY id`;
    const query = new QueryStream(sql, [sponsor]);
    const stream = client.query(query);

    if (format === "csv") {
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sponsor}-streams.csv"`,
      });
      res.write(EXPORT_COLUMNS.map(quoteCsv).join(",") + "\n");

      for await (const row of stream) {
        const values = EXPORT_COLUMNS.map((column) => quoteCsv(row[column]));
        res.write(values.join(",") + "\n");
      }
      res.end();
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.write("[");
    let first = true;
    for await (const row of stream) {
      if (!first) res.write(",");
      res.write(JSON.stringify(row));
      first = false;
    }
    res.write("]");
    res.end();
  } catch (err) {
    res.status(500).json({ error: String(err.message ?? err) });
  } finally {
    client.release();
  }
}

module.exports = { exportSponsorHandler };
