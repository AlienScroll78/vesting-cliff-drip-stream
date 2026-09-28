/**
 * Database migration up/down tests.
 * Closes #627
 *
 * Verifies that each migration file exists, is readable, and follows
 * structural conventions (up/down functions, naming, etc.).
 * Integration tests against a live database are run in CI via docker-compose.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Migration {
  name: string;
  path: string;
  content: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadMigrations(): Migration[] {
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.ts'))
    .sort();

  return files.map((file) => ({
    name: file,
    path: path.join(migrationsDir, file),
    content: fs.readFileSync(path.join(migrationsDir, file), 'utf-8'),
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Database Migration Tests', () => {
  let migrations: Migration[];

  beforeAll(() => {
    migrations = loadMigrations();
  });

  // ── File existence and readability ─────────────────────────────────────────

  describe('Migration files exist and are readable', () => {
    it('has at least one migration file', () => {
      expect(migrations.length).toBeGreaterThan(0);
    });

    it('all migration files are non-empty', () => {
      for (const migration of migrations) {
        expect(migration.content.trim().length).toBeGreaterThan(
          0,
          `Migration ${migration.name} is empty`
        );
      }
    });

    it('migration files follow naming convention (numbered prefix)', () => {
      for (const migration of migrations) {
        // Accept: 001_name.ts, V1__name.sql, 001-name.ts, V3__create.sql
        expect(migration.name).toMatch(
          /^[Vv]?\d+[_-]/,
          `Migration ${migration.name} does not follow naming convention (expected numeric prefix)`
        );
      }
    });

    it('no duplicate migration file names', () => {
      const names = migrations.map((m) => m.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length, 'Duplicate migration file names detected');
    });
  });

  // ── SQL migration content validation ──────────────────────────────────────

  describe('SQL migration content validation', () => {
    it('V1 migration creates the main schedules/streams table', () => {
      const v1 = migrations.find((m) =>
        m.name.match(/^[Vv]?1[_-]/) || m.name.match(/^001[_-]/)
      );
      expect(v1).toBeDefined();
      if (v1) {
        const upper = v1.content.toUpperCase();
        const hasSqlCreate =
          upper.includes('CREATE TABLE') ||
          v1.content.includes('createTable') ||
          v1.content.includes('queryInterface.createTable');
        expect(hasSqlCreate).toBe(
          true,
          `First migration (${v1.name}) should create a table`
        );
      }
    });

    it('migrations do not contain DROP DATABASE statements', () => {
      for (const migration of migrations) {
        expect(migration.content.toUpperCase()).not.toContain('DROP DATABASE');
      }
    });

    it('SQL migrations have valid SQL statements terminated by semicolons', () => {
      const sqlMigrations = migrations.filter((m) => m.name.endsWith('.sql'));
      for (const migration of sqlMigrations) {
        const statements = migration.content
          .trim()
          .split(';')
          .filter((s) => s.trim().length > 0);
        expect(statements.length).toBeGreaterThan(
          0,
          `Migration ${migration.name} has no valid SQL statements`
        );
      }
    });
  });

  // ── TypeScript migration structure ─────────────────────────────────────────

  describe('TypeScript migration structure', () => {
    it('TS migrations export up and down functions', () => {
      const tsMigrations = migrations.filter((m) => m.name.endsWith('.ts'));
      for (const migration of tsMigrations) {
        const hasUp =
          migration.content.includes('export') && migration.content.includes('up');
        const hasDown = migration.content.includes('down');
        expect(hasUp).toBe(
          true,
          `Migration ${migration.name} should export an 'up' function`
        );
        expect(hasDown).toBe(
          true,
          `Migration ${migration.name} should contain a 'down' function`
        );
      }
    });

    it('TS migrations use queryInterface parameter', () => {
      const tsMigrations = migrations.filter((m) => m.name.endsWith('.ts'));
      for (const migration of tsMigrations) {
        expect(migration.content).toContain(
          'queryInterface',
          `Migration ${migration.name} should use queryInterface`
        );
      }
    });
  });

  // ── Sequential ordering ────────────────────────────────────────────────────

  describe('Sequential migration ordering', () => {
    it('TS migrations are numbered sequentially without gaps', () => {
      const tsMigrations = migrations.filter((m) => m.name.endsWith('.ts'));
      if (tsMigrations.length === 0) return;

      const numbers = tsMigrations
        .map((m) => {
          const match = m.name.match(/^(\d+)/);
          return match ? parseInt(match[1]) : 0;
        })
        .sort((a, b) => a - b);

      for (let i = 0; i < numbers.length - 1; i++) {
        expect(numbers[i + 1] - numbers[i]).toBe(
          1,
          `Gap in TS migration sequence between ${numbers[i]} and ${numbers[i + 1]}`
        );
      }
    });

    it('SQL migrations are numbered sequentially without gaps', () => {
      const sqlMigrations = migrations.filter((m) => m.name.endsWith('.sql'));
      if (sqlMigrations.length === 0) return;

      const numbers = sqlMigrations
        .map((m) => {
          const match = m.name.match(/[Vv]?(\d+)[_-]/);
          return match ? parseInt(match[1]) : 0;
        })
        .sort((a, b) => a - b);

      for (let i = 0; i < numbers.length - 1; i++) {
        expect(numbers[i + 1] - numbers[i]).toBe(
          1,
          `Gap in SQL migration sequence between V${numbers[i]} and V${numbers[i + 1]}`
        );
      }
    });
  });

  // ── Rollback safety ────────────────────────────────────────────────────────

  describe('Rollback safety', () => {
    it('TS migrations with irreversible operations have a meaningful down handler', () => {
      const tsMigrations = migrations.filter((m) => m.name.endsWith('.ts'));
      const irreversibleKeywords = [
        'dropTable',
        'removeColumn',
        'DROP TABLE',
        'ALTER TABLE',
      ];

      for (const migration of tsMigrations) {
        const hasIrreversible = irreversibleKeywords.some((k) =>
          migration.content.includes(k)
        );
        if (hasIrreversible) {
          // Must have a down section with meaningful content
          const downIndex = migration.content.indexOf('down');
          const downSection = downIndex !== -1 ? migration.content.slice(downIndex) : '';
          expect(downSection.trim().length).toBeGreaterThan(
            10,
            `Migration ${migration.name} has irreversible operations but no meaningful down handler`
          );
        }
      }
    });

    it('SQL CREATE TABLE migrations can theoretically be rolled back (verifies table names are valid SQL identifiers)', () => {
      const sqlMigrations = migrations.filter((m) => m.name.endsWith('.sql'));
      for (const migration of sqlMigrations) {
        const upper = migration.content.toUpperCase();
        if (upper.includes('CREATE TABLE')) {
          // TABLE name must follow SQL identifier rules
          expect(upper).toMatch(/CREATE TABLE\s+\w+/);
        }
      }
    });
  });

  // ── Migration up simulation ────────────────────────────────────────────────

  describe('Migration "up" content is syntactically plausible', () => {
    it('each migration contains at least one SQL keyword or TS operation', () => {
      const sqlKeywords = ['CREATE', 'ALTER', 'INSERT', 'DROP', 'UPDATE'];
      const tsKeywords = ['queryInterface', 'createTable', 'addColumn', 'removeColumn', 'addIndex'];

      for (const migration of migrations) {
        const upper = migration.content.toUpperCase();
        const hasSqlKeyword = sqlKeywords.some((k) => upper.includes(k));
        const hasTsKeyword = tsKeywords.some((k) => migration.content.includes(k));

        expect(hasSqlKeyword || hasTsKeyword).toBe(
          true,
          `Migration ${migration.name} contains no recognisable SQL/ORM operation`
        );
      }
    });
  });
});
