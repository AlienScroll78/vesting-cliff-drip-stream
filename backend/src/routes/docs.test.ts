/**
 * Tests for GET /docs and GET /docs/openapi.yaml — issue #1006.
 *
 * Verifies that Swagger UI is served from api/openapi.yaml in
 * non-production environments and that both routes return 404 when
 * NODE_ENV === "production".
 */

import http from "http";
import express from "express";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { docsRouter } from "./docs.js";

const app = express();
app.use(docsRouter);

let server: http.Server;
let baseUrl: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
);

afterEach(() => {
  delete process.env.NODE_ENV;
});

describe("GET /docs (non-production)", () => {
  it("serves Swagger UI HTML", async () => {
    process.env.NODE_ENV = "development";
    const res = await fetch(`${baseUrl}/docs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("swagger-ui");
    expect(body).toContain("/docs/openapi.yaml");
  });

  it("serves Swagger UI when NODE_ENV is unset", async () => {
    delete process.env.NODE_ENV;
    const res = await fetch(`${baseUrl}/docs`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("swagger-ui");
  });

  it("serves Swagger UI in the test environment", async () => {
    process.env.NODE_ENV = "test";
    const res = await fetch(`${baseUrl}/docs`);
    expect(res.status).toBe(200);
  });
});

describe("GET /docs (production)", () => {
  it("returns 404 when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const res = await fetch(`${baseUrl}/docs`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });
});

describe("GET /docs/openapi.yaml", () => {
  it("serves the canonical spec in non-production", async () => {
    process.env.NODE_ENV = "development";
    const res = await fetch(`${baseUrl}/docs/openapi.yaml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/yaml");
    const body = await res.text();
    expect(body.startsWith("openapi: 3.0.3")).toBe(true);
  });

  it("returns 404 when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const res = await fetch(`${baseUrl}/docs/openapi.yaml`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });
});
