/**
 * MSW server for use in Vitest (Node environment via msw/node).
 * Import this in individual test files to apply per-test handler overrides.
 */
import { setupServer } from "msw/node";
import { defaultHandlers } from "./handlers";

export const server = setupServer(...defaultHandlers);
