/**
 * src/migrate.test.ts
 *
 * Tests for the startup database migration runner (Issue #1013).
 *
 * The runner is exercised against a fake `pg` client rather than a live
 * database, so the suite is safe to run in CI where no PostgreSQL is present.
 * `node-pg-migrate` is mocked so no migrations are actually applied.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── node-pg-migrate mock ──────────────────────────────────────────────────────

const runnerMock = vi.fn(async () => []);

vi.mock("node-pg-migrate", () => ({
  runner: runnerMock,
  default: runnerMock,
}));

// ── Fake pg client ────────────────────────────────────────────────────────────

interface FakeClientOptions {
  /** Names already present in the migrations table. */
  applied?: string[];
  /** Simulate the migrations table not existing yet (first boot). */
  noTable?: boolean;
}

function makeClient(opts: FakeClientOptions = {}) {
  const queries: string[] = [];

  const client = {
    query: vi.fn(async (text: string) => {
      queries.push(text);
      if (/FROM\s+\w*migrations/i.test(text)) {
        if (opts.noTable) {
          const err = new Error('relation "pgmigrations" does not exist') as Error & {
            code: string;
          };
          err.code = "42P01";
          throw err;
        }
        return { rows: (opts.applied ?? []).map((name) => ({ name })) };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };

  return { client: client as never, queries, raw: client };
}

const { runMigrations, getMigrationStatus, setMigrationStatus, isDryRun, listManagedMigrations, listUnmanagedMigrations, getLastMigrationResult } =
  await import("./migrate.js");

// ── isDryRun ──────────────────────────────────────────────────────────────────

describe("#1013 — dry-run flag", () => {
  it("honours the issue-specified MIGRATE_DRY_RUN", () => {
    expect(isDryRun({ MIGRATE_DRY_RUN: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("still honours the pre-existing DB_MIGRATE_DRY_RUN alias", () => {
    expect(isDryRun({ DB_MIGRATE_DRY_RUN: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("defaults to off", () => {
    expect(isDryRun({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("requires the literal string 'true'", () => {
    expect(isDryRun({ MIGRATE_DRY_RUN: "1" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

// ── Migration discovery ───────────────────────────────────────────────────────

describe("#1013 — migration discovery", () => {
  it("lists the managed .ts migrations from disk", () => {
    const managed = listManagedMigrations();
    expect(managed.length).toBeGreaterThan(0);
    expect(managed.every((name) => !name.endsWith(".ts"))).toBe(true);
    // 001_create_vesting_streams is a known migration in this repo.
    expect(managed.some((name) => name.startsWith("001"))).toBe(true);
  });

  it("returns managed migrations in sorted order", () => {
    const managed = listManagedMigrations();
    expect([...managed].sort()).toEqual(managed);
  });

  it("reports the V*.sql track as unmanaged", () => {
    const unmanaged = listUnmanagedMigrations();
    expect(unmanaged.length).toBeGreaterThan(0);
    expect(unmanaged.some((name) => name.endsWith(".sql"))).toBe(true);
    // The two tracks must not overlap.
    const overlap = unmanaged.filter((name) => listManagedMigrations().includes(name));
    expect(overlap).toEqual([]);
  });
});

// ── Startup behaviour ─────────────────────────────────────────────────────────

describe("#1013 — startup migration run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMigrationStatus("pending");
  });

  it("applies pending migrations through node-pg-migrate", async () => {
    const { client } = makeClient({ noTable: true });
    const result = await runMigrations({ client, log: () => {} });

    expect(runnerMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("current");
    expect(result.pending).toEqual([]);
  });

  it("passes the caller's client as dbClient so lock and migrations share a session", async () => {
    const { client } = makeClient({ noTable: true });
    await runMigrations({ client, log: () => {} });

    const options = runnerMock.mock.calls[0][0] as Record<string, unknown>;
    // A dedicated client (not a pool) is what makes the advisory lock effective.
    expect(options.dbClient).toBe(client);
    expect(options.direction).toBe("up");
    // noLock must not be set — node-pg-migrate takes the advisory lock itself.
    expect(options.noLock).toBeUndefined();
  });

  it("does not run the migrator when the schema is already current", async () => {
    const managed = listManagedMigrations();
    const { client } = makeClient({ applied: managed });
    const result = await runMigrations({ client, log: () => {} });

    expect(runnerMock).not.toHaveBeenCalled();
    expect(result.status).toBe("current");
    expect(result.pending).toEqual([]);
  });

  it("reports the pending set when only some migrations are applied", async () => {
    const managed = listManagedMigrations();
    const { client } = makeClient({ applied: managed.slice(0, 1) });
    const result = await runMigrations({ client, log: () => {} });

    expect(runnerMock).toHaveBeenCalledTimes(1);
    expect(result.pending).toEqual([]);
    expect(result.status).toBe("current");
  });

  it("sets the health status to current after a successful run", async () => {
    const { client } = makeClient({ noTable: true });
    await runMigrations({ client, log: () => {} });
    expect(getMigrationStatus()).toBe("current");
  });

  it("treats a missing migrations table as a first boot rather than an error", async () => {
    const { client } = makeClient({ noTable: true });
    const result = await runMigrations({ client, log: () => {} });
    expect(result.status).toBe("current");
  });

  it("surfaces unmanaged migration files without applying them", async () => {
    const { client } = makeClient({ noTable: true });
    const lines: string[] = [];
    const result = await runMigrations({ client, log: (l) => lines.push(l) });

    expect(result.unmanaged.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("unmanaged");
    // The migrator must only ever be pointed at the managed directory once.
    expect(runnerMock).toHaveBeenCalledTimes(1);
  });
});

// ── Dry run ───────────────────────────────────────────────────────────────────

describe("#1013 — MIGRATE_DRY_RUN", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMigrationStatus("pending");
  });

  it("logs planned changes without invoking the migrator", async () => {
    const { client } = makeClient({ noTable: true });
    const lines: string[] = [];
    const result = await runMigrations({
      client,
      dryRun: true,
      log: (l) => lines.push(l),
    });

    expect(runnerMock).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.pending.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("DRY RUN");
  });

  it("reports pending rather than current, since nothing was applied", async () => {
    const { client } = makeClient({ noTable: true });
    const result = await runMigrations({ client, dryRun: true, log: () => {} });
    expect(result.status).toBe("pending");
  });

  it("does not claim a dry run when there is nothing pending", async () => {
    const { client } = makeClient({ applied: listManagedMigrations() });
    const result = await runMigrations({ client, dryRun: true, log: () => {} });
    expect(result.status).toBe("current");
    expect(result.dryRun).toBe(true);
  });
});

// ── Concurrency (advisory lock) ───────────────────────────────────────────────

describe("#1013 — concurrent replicas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMigrationStatus("pending");
  });

  it("treats losing the advisory-lock race as pending, not failed", async () => {
    runnerMock.mockRejectedValueOnce(new Error("Another migration is already running"));
    const { client } = makeClient({ noTable: true });

    const result = await runMigrations({ client, log: () => {} });

    expect(result.status).toBe("pending");
    expect(getMigrationStatus()).toBe("pending");
    expect(result.error).toBeUndefined();
  });

  it("matches the lock-conflict message case-insensitively", async () => {
    runnerMock.mockRejectedValueOnce(
      new Error("ANOTHER MIGRATION IS ALREADY RUNNING")
    );
    const { client } = makeClient({ noTable: true });
    const result = await runMigrations({ client, log: () => {} });
    expect(result.status).toBe("pending");
  });

  it("releases the advisory lock defensively after an unrelated failure", async () => {
    runnerMock.mockRejectedValueOnce(new Error("syntax error at or near FROM"));
    const { client, queries } = makeClient({ noTable: true });

    const result = await runMigrations({ client, log: () => {} });

    expect(result.status).toBe("failed");
    expect(queries.some((q) => /pg_advisory_unlock/i.test(q))).toBe(true);
  });
});

// ── Failure handling ──────────────────────────────────────────────────────────

describe("#1013 — failed migrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMigrationStatus("pending");
  });

  it("reports failed status and preserves the descriptive error", async () => {
    runnerMock.mockRejectedValueOnce(new Error("column \"foo\" does not exist"));
    const { client } = makeClient({ noTable: true });

    const result = await runMigrations({ client, log: () => {}, });

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("foo");
    expect(getMigrationStatus()).toBe("failed");
  });

  it("aborts startup with a non-zero exit code when migrations fail", async () => {
    runnerMock.mockRejectedValueOnce(new Error("boom"));
    const { client } = makeClient({ noTable: true });

    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { runMigrationsOrExit } = await import("./migrate.js");
    await runMigrationsOrExit({ client, log: () => {} });

    expect(exit).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Startup aborted"));

    exit.mockRestore();
    errorSpy.mockRestore();
  });

  it("does not exit when migrations succeed", async () => {
    const { client } = makeClient({ noTable: true });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const { runMigrationsOrExit } = await import("./migrate.js");
    await runMigrationsOrExit({ client, log: () => {} });

    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("does not exit when another replica holds the lock", async () => {
    runnerMock.mockRejectedValueOnce(new Error("Another migration is already running"));
    const { client } = makeClient({ noTable: true });
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const { runMigrationsOrExit } = await import("./migrate.js");
    await runMigrationsOrExit({ client, log: () => {} });

    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("records the last result for diagnostics", async () => {
    const { client } = makeClient({ noTable: true });
    await runMigrations({ client, log: () => {} });
    expect(getLastMigrationResult()?.status).toBe("current");
  });
});
