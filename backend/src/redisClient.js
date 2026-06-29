"use strict";

const { createClient } = require("redis");

let client;

async function createRedisClient() {
  if (client && client.isOpen) {
    return client;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for Redis-backed features");
  }

  client = createClient({ url: redisUrl });
  client.on("error", (err) => {
    console.error("[redis] Redis client error:", err);
  });
  await client.connect();
  return client;
}

module.exports = { createRedisClient };
