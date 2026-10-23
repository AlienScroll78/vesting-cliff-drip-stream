#!/usr/bin/env node
/**
 * Issue #1062 — snapshot test runner.
 *
 * Exposes a stable `--update-snapshots` flag (the flag name used by the
 * issue's acceptance criteria) and forwards everything else to Vitest.
 *
 *   node scripts/run-snapshot-tests.mjs             # verify against committed snapshots
 *   node scripts/run-snapshot-tests.mjs --update-snapshots
 *
 * On an update run the snapshot files are rewritten in place; the diff must
 * be reviewed and committed deliberately.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const UPDATE_FLAG = "--update-snapshots";
const args = process.argv.slice(2);
const shouldUpdate = args.includes(UPDATE_FLAG);
const passthrough = args.filter((arg) => arg !== UPDATE_FLAG);

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const vitestArgs = [
  "run",
  "--config",
  "vitest.snapshot.config.ts",
  ...(shouldUpdate ? ["--update"] : []),
  ...passthrough,
];

const child = spawn("npx", ["vitest", ...vitestArgs], {
  cwd: backendRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code) => {
  if (shouldUpdate && code === 0) {
    process.stdout.write(
      "\n[snapshot-tests] snapshots updated — review and commit the diff.\n",
    );
  }
  process.exit(code ?? 1);
});
