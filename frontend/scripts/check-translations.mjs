import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const localeDirectory = new URL("../public/locales/", import.meta.url);
const englishPath = new URL("../public/locales/en.json", import.meta.url);
const english = JSON.parse(readFileSync(englishPath, "utf8"));
const files = readdirSync(localeDirectory).filter((file) => file.endsWith(".json"));
const failures = [];

function getValue(resource, path) {
  return path.split(".").reduce((value, part) => value?.[part], resource);
}

function flattenKeys(resource, prefix = "") {
  return Object.entries(resource).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" && !Array.isArray(value)
      ? flattenKeys(value, path)
      : [path];
  });
}

const sourceFiles = [];
for (const directory of ["src", "wizard", "components", "app"]) {
  try {
    sourceFiles.push(...readdirSync(new URL(`../${directory}/`, import.meta.url), { recursive: true })
      .filter((file) => /\.(tsx?|jsx?)$/.test(file))
      .map((file) => new URL(`../${directory}/${file}`, import.meta.url)));
  } catch {
    // The recursive scan below is optional for directories missing in older layouts.
  }
}

const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
  if (getValue(english, match[1]) === undefined) {
    failures.push(`English locale is missing key "${match[1]}"`);
  }
}

for (const code of ["1", "2", "3", "4", "5", "6", "7"]) {
  for (const field of ["title", "explanation", "action"]) {
    if (getValue(english, `errors.${code}.${field}`) === undefined) {
      failures.push(`English locale is missing errors.${code}.${field}`);
    }
  }
}

for (const file of files) {
  try {
    JSON.parse(readFileSync(new URL(`../public/locales/${file}`, import.meta.url), "utf8"));
  } catch (error) {
    failures.push(`${file} is invalid JSON: ${error.message}`);
  }
}

const requiredKeys = flattenKeys(english);
if (!files.includes("en.json")) failures.push("English locale file en.json is missing");
if (requiredKeys.length === 0) failures.push("English locale has no translation keys");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${requiredKeys.length} English keys across ${files.length} locale files.`);
}