#!/usr/bin/env node
/**
 * check-i18n-keys.js — CI translation key parity checker (#767)
 *
 * Verifies that every translation file under
 * frontend/public/locales/{lng}/translation.json contains exactly the same
 * set of leaf keys as the English reference file (en/translation.json).
 *
 * Usage:
 *   node scripts/check-i18n-keys.js
 *
 * Exit codes:
 *   0  — all locales are complete
 *   1  — one or more locales have missing or extra keys
 *
 * The script is intentionally dependency-free (Node built-ins only) so it
 * runs in any CI environment without an npm install step.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Configuration ─────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../frontend/public/locales");
const REFERENCE_LOCALE = "en";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively collect every leaf key path from a nested object.
 * Returns a sorted array of dot-separated key paths.
 *
 * @param {Record<string, unknown>} obj
 * @param {string} prefix
 * @returns {string[]}
 */
function collectLeafKeys(obj, prefix = "") {
  /** @type {string[]} */
  const keys = [];

  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectLeafKeys(/** @type {Record<string, unknown>} */ (v), fullKey));
    } else {
      keys.push(fullKey);
    }
  }

  return keys.sort();
}

/**
 * Load and parse a JSON file. Throws with a descriptive message on failure.
 *
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${err.message}`);
  }
}

/**
 * Compute symmetric difference between two sorted key arrays.
 *
 * @param {string[]} reference
 * @param {string[]} target
 * @returns {{ missing: string[]; extra: string[] }}
 */
function diff(reference, target) {
  const refSet = new Set(reference);
  const tgtSet = new Set(target);

  return {
    missing: reference.filter((k) => !tgtSet.has(k)),
    extra: target.filter((k) => !refSet.has(k)),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  // Load reference (EN) translation
  const refPath = path.join(LOCALES_DIR, REFERENCE_LOCALE, "translation.json");
  let refJson;
  try {
    refJson = loadJson(refPath);
  } catch (err) {
    console.error(`\n❌  Cannot load reference locale: ${err.message}`);
    process.exit(1);
  }

  const refKeys = collectLeafKeys(refJson);
  console.log(
    `\n📖  Reference locale: ${REFERENCE_LOCALE} (${refKeys.length} keys)\n`
  );

  // Discover all locale directories
  let localeDirs;
  try {
    localeDirs = fs
      .readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => name !== REFERENCE_LOCALE)
      .sort();
  } catch (err) {
    console.error(`❌  Cannot read locales directory: ${err.message}`);
    process.exit(1);
  }

  if (localeDirs.length === 0) {
    console.warn("⚠️   No non-reference locale directories found. Nothing to check.");
    process.exit(0);
  }

  let hasErrors = false;

  for (const lng of localeDirs) {
    const filePath = path.join(LOCALES_DIR, lng, "translation.json");
    let tgtJson;

    try {
      tgtJson = loadJson(filePath);
    } catch (err) {
      console.error(`❌  [${lng}] ${err.message}`);
      hasErrors = true;
      continue;
    }

    const tgtKeys = collectLeafKeys(tgtJson);
    const { missing, extra } = diff(refKeys, tgtKeys);

    if (missing.length === 0 && extra.length === 0) {
      console.log(`✅  [${lng}] All ${tgtKeys.length} keys present.`);
    } else {
      hasErrors = true;

      if (missing.length > 0) {
        console.error(
          `❌  [${lng}] Missing ${missing.length} key(s) (present in EN but absent in ${lng}):`
        );
        for (const k of missing) {
          console.error(`      - ${k}`);
        }
      }

      if (extra.length > 0) {
        console.warn(
          `⚠️   [${lng}] Extra ${extra.length} key(s) (present in ${lng} but absent in EN):`
        );
        for (const k of extra) {
          console.warn(`      + ${k}`);
        }
      }
    }
  }

  console.log("");

  if (hasErrors) {
    console.error(
      "❌  Translation key check FAILED. Fix the issues above before merging.\n"
    );
    process.exit(1);
  } else {
    console.log("✅  All translation files are in sync with the EN reference.\n");
    process.exit(0);
  }
}

main();
