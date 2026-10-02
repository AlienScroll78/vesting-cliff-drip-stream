import { describe, it, expect } from "vitest";
import {
  errorMessages,
  getErrorInfo,
  getErrorMessage,
  getErrorName,
  isKnownErrorCode,
  VESTING_ERROR_CODES,
  type VestingErrorName,
} from "../errorMessages";
import en from "@/i18n/locales/en.json";

const NAMES = Object.keys(VESTING_ERROR_CODES) as VestingErrorName[];

describe("errorMessages — coverage", () => {
  it("defines exactly the 26 documented VestingError codes", () => {
    expect(NAMES).toHaveLength(26);
  });

  it("assigns each error name a unique code", () => {
    const codes = NAMES.map((n) => VESTING_ERROR_CODES[n]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has a message entry for every code", () => {
    for (const name of NAMES) {
      const code = VESTING_ERROR_CODES[name];
      expect(errorMessages[code], `missing message for ${name} (${code})`).toBeDefined();
    }
  });

  it("maps codes 1 through 26 with no gaps", () => {
    for (let code = 1; code <= 26; code++) {
      expect(errorMessages[code], `missing code ${code}`).toBeDefined();
    }
  });
});

describe("errorMessages — copy quality", () => {
  const codes = NAMES.map((n) => VESTING_ERROR_CODES[n]);

  it.each(codes)("code %i has a title, explanation and action", (code) => {
    const info = errorMessages[code]!;
    expect(info.title.length).toBeGreaterThan(0);
    expect(info.explanation.length).toBeGreaterThan(0);
    expect(info.action.length).toBeGreaterThan(0);
  });

  it.each(codes)("code %i exposes a valid category", (code) => {
    expect(["network", "auth", "contract", "unexpected"]).toContain(
      errorMessages[code]!.category,
    );
  });

  it.each(codes)("code %i has an i18n key", (code) => {
    expect(errorMessages[code]!.i18nKey).toMatch(/^errors\.codes\.[A-Za-z]+$/);
  });

  it("never leaks raw contract error names or function names into the copy", () => {
    // Technical identifiers that must not appear in user-facing text.
    const forbidden = [
      "VestingError",
      "create_vesting_stream",
      "claim_vested",
      "cancel_stream",
      "clawback_stream",
      "i128",
      "cliff_ledger",
      "rate_per_ledger",
      "total_duration",
    ];

    for (const name of NAMES) {
      const info = errorMessages[VESTING_ERROR_CODES[name]]!;
      const copy = `${info.title} ${info.explanation} ${info.action}`;
      for (const term of forbidden) {
        expect(copy, `${name} leaks "${term}"`).not.toContain(term);
      }
    }
  });

  it("never renders a bare error code as the message", () => {
    for (const name of NAMES) {
      const code = VESTING_ERROR_CODES[name];
      const message = getErrorMessage(code);
      expect(message).not.toMatch(new RegExp(`^Error:\\s*${code}\\b`));
      expect(message).not.toMatch(new RegExp(`\\berror code ${code}\\b`, "i"));
    }
  });

  it("carries an i18n key matching its error name", () => {
    for (const name of NAMES) {
      expect(errorMessages[VESTING_ERROR_CODES[name]]!.i18nKey).toBe(
        `errors.codes.${name}`,
      );
    }
  });
});

describe("errorMessages — i18n key parity", () => {
  it("en.json has a title/explanation/action for every error name", () => {
    for (const name of NAMES) {
      const entry = (en.errors as Record<string, Record<string, string>>).codes?.[name];
      expect(entry, `en.json missing errors.codes.${name}`).toBeDefined();
      expect(entry!.title.length).toBeGreaterThan(0);
      expect(entry!.explanation.length).toBeGreaterThan(0);
      expect(entry!.action.length).toBeGreaterThan(0);
    }
  });

  it("en.json defines the Unexpected fallback too", () => {
    const entry = (en.errors as Record<string, Record<string, string>>).codes?.Unexpected;
    expect(entry).toBeDefined();
  });
});

describe("getErrorInfo", () => {
  it("returns the mapped entry for a known code", () => {
    expect(getErrorInfo(2).title).toMatch(/cliff date hasn't arrived/i);
  });

  it("falls back to a generic entry for an unknown code", () => {
    const info = getErrorInfo(9999);
    expect(info.category).toBe("unexpected");
    expect(info.title.length).toBeGreaterThan(0);
  });

  it("falls back for code 0 (Soroban success sentinel)", () => {
    expect(getErrorInfo(0).category).toBe("unexpected");
  });
});

describe("getErrorMessage", () => {
  it("interpolates the cliff date for CliffNotReached", () => {
    const msg = getErrorMessage(2, { date: "12 Mar 2026" });
    expect(msg).toContain("12 Mar 2026");
    expect(msg).toMatch(/cliff date hasn't arrived yet/i);
  });

  it("interpolates the address for ScheduleNotFound", () => {
    const msg = getErrorMessage(1, { address: "GABC…" });
    expect(msg).toContain("GABC…");
    expect(msg).toMatch(/double-check the address/i);
  });

  it("combines title, explanation and action when no values are given", () => {
    const info = getErrorInfo(7);
    expect(getErrorMessage(7)).toBe(`${info.title}. ${info.explanation} ${info.action}`);
  });

  it("reassures the user on TransferFailed", () => {
    expect(getErrorMessage(9)).toMatch(/tokens are safe/i);
  });

  it("tells the user to wait on NothingToClaim", () => {
    expect(getErrorMessage(7)).toMatch(/check back soon/i);
  });
});

describe("getErrorName", () => {
  it("resolves a code back to its contract name", () => {
    expect(getErrorName(2)).toBe("CliffNotReached");
    expect(getErrorName(15)).toBe("StreamPaused");
  });

  it("returns Unexpected for an unknown code", () => {
    expect(getErrorName(9999)).toBe("Unexpected");
  });
});

describe("isKnownErrorCode", () => {
  it.each(NAMES.map((n) => VESTING_ERROR_CODES[n]))("recognises code %i", (code) => {
    expect(isKnownErrorCode(code)).toBe(true);
  });

  it("rejects an unknown code", () => {
    expect(isKnownErrorCode(9999)).toBe(false);
  });
});
