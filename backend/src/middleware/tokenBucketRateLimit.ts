import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { createClient } from "redis";
import { rateLimitHitsTotal } from "../metrics.js";

type LimitType = "ip" | "address" | "jwt_subject";

const TOKEN_BUCKET_SCRIPT = `
local capacity = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local refill_rate = capacity / window_ms
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens')) or capacity
local last_ms = tonumber(redis.call('HGET', KEYS[1], 'updated_at')) or now_ms
tokens = math.min(capacity, tokens + math.max(0, now_ms - last_ms) * refill_rate)
local allowed = 0
local retry_ms = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry_ms = math.ceil((1 - tokens) / refill_rate)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_at', now_ms)
redis.call('PEXPIRE', KEYS[1], window_ms * 2)
return { allowed, math.floor(tokens), retry_ms }
`;

let redis: ReturnType<typeof createClient> | null = null;
let redisConnection: Promise<ReturnType<typeof createClient> | null> | null = null;

async function getRedis(): Promise<ReturnType<typeof createClient> | null> {
  if (redis?.isOpen) return redis;
  if (redisConnection) return redisConnection;
  redisConnection = (async () => {
    const client = createClient({
      url: process.env.REDIS_URL ?? "redis://localhost:6379",
    });
    client.on("error", () => {});
    try {
      await client.connect();
      redis = client;
      return client;
    } catch {
      redis = null;
      return null;
    }
  })();
  try {
    return await redisConnection;
  } finally {
    redisConnection = null;
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function positiveLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function jwtSubject(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length);
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : undefined;
  } catch {
    return undefined;
  }
}

function requestAddress(req: Request): string | undefined {
  const user = (req as Request & { user?: { address?: string } }).user;
  const body = req.body as
    | { address?: unknown; recipient?: unknown; sponsor?: unknown }
    | undefined;
  const candidate =
    user?.address ?? body?.address ?? body?.recipient ?? body?.sponsor;
  return typeof candidate === "string" ? candidate : undefined;
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const windowSec = positiveLimit(process.env.RATE_LIMIT_WINDOW_SEC, 60);
  const publicLimit = positiveLimit(
    process.env.RATE_LIMIT_READ_MAX ?? process.env.RATE_LIMIT_IP_MAX,
    60,
  );
  const buildLimit = positiveLimit(
    process.env.RATE_LIMIT_BUILD_TX_MAX ?? process.env.RATE_LIMIT_WRITE_MAX,
    10,
  );
  const adminLimit = positiveLimit(process.env.RATE_LIMIT_ADMIN_MAX, 5);
  const apiKey = req.headers["x-api-key"] as string | undefined;
  const bypassKeys = (process.env.RATE_LIMIT_BYPASS_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (apiKey && bypassKeys.includes(apiKey)) {
    next();
    return;
  }

  const ip = clientIp(req);
  const path = req.path.toLowerCase();
  const isAdmin = path === "/admin" || path.startsWith("/admin/");
  const isBuildTx = req.method === "POST" && /(?:^|\/)build-tx(?:\/|$)/.test(path);

  let type: LimitType = "ip";
  let identity = ip;
  let limit = publicLimit;
  let endpoint = "public_read";

  if (isAdmin) {
    type = "jwt_subject";
    identity = jwtSubject(req) ?? `token:${digest(req.headers.authorization ?? ip)}`;
    limit = adminLimit;
    endpoint = "admin";
  } else if (isBuildTx) {
    type = "address";
    identity = requestAddress(req) ?? `ip:${ip}`;
    limit = buildLimit;
    endpoint = "build_tx";
  }

  const client = await getRedis();
  if (!client) {
    next();
    return;
  }

  try {
    const key = `rate-limit:${type}:${digest(identity)}:${endpoint}`;
    const result = (await client.eval(TOKEN_BUCKET_SCRIPT, {
      keys: [key],
      arguments: [String(limit), String(windowSec * 1000), String(Date.now())],
    })) as [number, number, number];
    const [allowed, remaining, retryMs] = result;
    const retryAfter = Math.max(1, Math.ceil(retryMs / 1000));

    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, remaining));
    res.setHeader("X-RateLimit-Reset", retryAfter);
    if (allowed === 0) {
      res.setHeader("Retry-After", retryAfter);
      rateLimitHitsTotal.labels(endpoint, type).inc();
      res.status(429).json({ error: "Too Many Requests", retryAfter });
      return;
    }
    next();
  } catch {
    next();
  }
}
