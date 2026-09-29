/**
 * e2e/helpers/axe.ts
 *
 * Shared accessibility scanning helper using axe-core via @axe-core/playwright.
 * Closes #362 – axe-core accessibility scanning.
 *
 * Usage:
 *   import { scanPageForViolations, saveViolationsReport } from '../helpers/axe';
 *
 *   await scanPageForViolations(page, 'Dashboard');
 */

import { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ViolationSummary {
  id: string;
  impact: string | null;
  description: string;
  helpUrl: string;
  nodes: number;
}

export interface ScanResult {
  violations: ViolationSummary[];
  passCount: number;
  incompleteCount: number;
  inapplicableCount: number;
}

// ── Known acceptable suppressions ────────────────────────────────────────────
//
// Only suppress violations that are genuinely inapplicable to this dApp or
// are third-party widget issues outside our control.  Each entry MUST include
// a justification comment so reviewers understand why it is acceptable.

const SUPPRESSED_RULES: string[] = [
  // "color-contrast" suppressed for third-party Freighter wallet modal which
  // is rendered inside an iframe we do not own.  Tracked for upstream fix.
  // "color-contrast",
];

// ── Core scan function ────────────────────────────────────────────────────────

/**
 * Runs an axe-core WCAG 2.1 AA scan against the current page state.
 *
 * @param page         Playwright Page object
 * @param scanName     Human-readable name used in the report filename
 * @param options.tags axe rule tags to run (default: wcag2a, wcag2aa, wcag21a, wcag21aa)
 * @param options.darkMode  Set to true to append "-dark" to the report name
 * @param options.mobile    Set to true to record that this is a mobile-viewport scan
 *
 * Returns the raw axe Results so callers can make additional assertions.
 */
export async function runAxeScan(
  page: Page,
  scanName: string,
  options: {
    tags?: string[];
    darkMode?: boolean;
    mobile?: boolean;
  } = {}
) {
  const {
    tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    darkMode = false,
    mobile = false,
  } = options;

  const suffix =
    (darkMode ? "-dark" : "") + (mobile ? "-mobile" : "");
  const reportName = `${scanName}${suffix}`;

  const builder = new AxeBuilder({ page })
    .withTags(tags)
    .exclude("[data-testid='wallet-iframe']"); // exclude third-party wallet iframe

  // Apply known acceptable suppressions
  if (SUPPRESSED_RULES.length > 0) {
    builder.disableRules(SUPPRESSED_RULES);
  }

  const results = await builder.analyze();

  // Save the full report as a test artifact
  saveViolationsReport(reportName, results);

  return results;
}

/**
 * Scans the page and asserts that there are no critical or serious violations.
 * CI fails on any critical or serious violation (#362 acceptance criterion).
 *
 * Use this in `expect`-style Playwright tests via:
 *   await scanPageForViolations(page, 'Dashboard');
 */
export async function scanPageForViolations(
  page: Page,
  scanName: string,
  options: Parameters<typeof runAxeScan>[2] = {}
): Promise<void> {
  const results = await runAxeScan(page, scanName, options);

  // Filter to critical and serious — these block CI (#362)
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );

  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (v) =>
          `  [${v.impact?.toUpperCase()}] ${v.id}: ${v.description}\n` +
          `    Nodes affected: ${v.nodes.length}\n` +
          `    Help: ${v.helpUrl}`
      )
      .join("\n\n");

    throw new Error(
      `axe-core found ${blocking.length} critical/serious violation(s) on "${scanName}":\n\n${summary}\n\n` +
        `Full report saved to: test-results/a11y-reports/${scanName}.json`
    );
  }
}

// ── Report persistence ────────────────────────────────────────────────────────

/**
 * Writes the full axe Results to disk as a JSON artifact.
 * The file is always written so it appears in CI artifacts even on pass.
 */
export function saveViolationsReport(
  scanName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: any
): void {
  const dir = path.join(
    process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results",
    "a11y-reports"
  );
  fs.mkdirSync(dir, { recursive: true });

  const safe = scanName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(dir, `${safe}.json`);

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        scanName,
        timestamp: new Date().toISOString(),
        url: results.url,
        violations: results.violations,
        passes: results.passes?.length ?? 0,
        incomplete: results.incomplete?.length ?? 0,
        inapplicable: results.inapplicable?.length ?? 0,
      },
      null,
      2
    )
  );
}
