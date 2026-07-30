/**
 * Vitest setup file.
 * Boots the MSW server before all tests and tears it down after.
 */
import "@testing-library/jest-dom";
import React from "react";
import { server } from "./mswServer";
import { beforeAll, afterEach, afterAll } from "vitest";

// Ensure React is available globally for JSX in test files
(globalThis as unknown as Record<string, unknown>).React = React;

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
