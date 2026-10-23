"use strict";

/**
 * webhookValidator.js — validates webhook URLs.
 *
 * Rules:
 *   1. Must use HTTPS scheme.
 *   2. Must not target private/loopback IP ranges (RFC 1918, RFC 4193, loopback).
 *   3. Must have a valid hostname.
 */

const dns = require("dns").promises;

// Private / reserved IPv4 CIDR blocks
const PRIVATE_IPV4_PATTERNS = [
  /^127\./,                        // 127.0.0.0/8   loopback
  /^10\./,                         // 10.0.0.0/8    RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,   // 172.16.0.0/12 RFC 1918
  /^192\.168\./,                   // 192.168.0.0/16 RFC 1918
  /^169\.254\./,                   // 169.254.0.0/16 link-local
  /^0\./,                          // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // 100.64.0.0/10 CGNAT
];

// Private IPv6 patterns
const PRIVATE_IPV6_PATTERNS = [
  /^::1$/,           // loopback
  /^fc/i,            // fc00::/7 unique local
  /^fd/i,
  /^fe80/i,          // fe80::/10 link-local
];

function isPrivateIp(host) {
  // Strip square brackets from IPv6 literals
  const h = host.replace(/^\[(.+)\]$/, "$1");

  for (const re of PRIVATE_IPV4_PATTERNS) {
    if (re.test(h)) return true;
  }
  for (const re of PRIVATE_IPV6_PATTERNS) {
    if (re.test(h)) return true;
  }
  return false;
}

/**
 * Validate a webhook URL synchronously (no DNS resolution).
 * Returns { valid: true } or { valid: false, reason: string }.
 */
function validateWebhookUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, reason: "URL is not valid" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "Webhook URL must use HTTPS" };
  }

  const host = parsed.hostname;
  if (!host) {
    return { valid: false, reason: "URL has no hostname" };
  }

  if (isPrivateIp(host)) {
    return { valid: false, reason: "Webhook URL must not target a private or loopback IP address" };
  }

  // Reject bare 'localhost' regardless of casing
  if (host.toLowerCase() === "localhost") {
    return { valid: false, reason: "Webhook URL must not target localhost" };
  }

  return { valid: true };
}

/**
 * Optionally resolve the hostname and re-check the resolved IPs.
 * Call this for extra security; it is async due to DNS lookup.
 */
async function validateWebhookUrlDeep(raw) {
  const sync = validateWebhookUrl(raw);
  if (!sync.valid) return sync;

  const { hostname } = new URL(raw);

  // If it looks like a bare IP address skip the DNS step (already checked)
  const isIpLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
    hostname.startsWith("[");
  if (isIpLiteral) return sync;

  try {
    const addresses = await dns.resolve(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        return {
          valid: false,
          reason: `Hostname resolves to a private IP address (${addr})`,
        };
      }
    }
  } catch {
    // DNS failure is not treated as invalid — the delivery attempt will fail
    // naturally.  We only block confirmed private IPs.
  }

  return { valid: true };
}

module.exports = { validateWebhookUrl, validateWebhookUrlDeep };
