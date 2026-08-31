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

// jsdom does not implement matchMedia. Provide a safe "no preference"
// default so components using useReducedMotion / useDarkMode-style media
// queries don't crash in tests that don't care about it; tests that do
// care (useDarkMode.test.ts, useReducedMotion.test.ts) override it locally.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
