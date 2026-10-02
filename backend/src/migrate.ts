import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const migrationDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

export async function runMigrations(): Promise<void> {
  const dryRun = process.env.DB_MIGRATE_DRY_RUN === "true";
  execFileSync("npm", ["run", dryRun ? "migrate:dry-run" : "migrate"], {
    cwd: backendDirectory,
    stdio: "inherit",
  });

  const expected = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.slice(0, -3));
  const { rows } = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations",
  );
  const applied = new Set(rows.map((row) => row.name));
  const missing = expected.filter((name) => !applied.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Database migrations are not applied: ${missing.join(", ")}`,
    );
  }
}
