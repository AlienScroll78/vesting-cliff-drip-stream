/**
 * Unit tests for the ledger-to-human-time converter (issue #1023).
 *
 * All tests are pure – no React, no DOM, no mocks required.
 * Run with: cd frontend && npx vitest run src/utils/ledgerTime.test.ts
 */

import { describe, test, expect } from "vitest";
import {
  SECONDS_PER_LEDGER,
  ledgerToDate,
  dateToLedger,
  ledgerDuration,
  humanInputToLedgers,
  formatLedgerWithTime,
} from "./ledgerTime";

// ── Constants ────────────────────────────────────────────────────────────────

describe("SECONDS_PER_LEDGER", () => {
  test("is 5 (Stellar average ledger close time)", () => {
    expect(SECONDS_PER_LEDGER).toBe(5);
  });
});

// ── ledgerToDate ─────────────────────────────────────────────────────────────

describe("ledgerToDate", () => {
  const ANCHOR_LEDGER = 1_000_000;
  const ANCHOR_DATE   = new Date("2025-01-01T00:00:00.000Z");

  test("returns the anchor date when targetLedger === currentLedger", () => {
    const result = ledgerToDate(ANCHOR_LEDGER, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result.getTime()).toBe(ANCHOR_DATE.getTime());
  });

  test("adds 5 seconds per ledger in the future", () => {
    // 1 ledger ahead = 5 seconds later
    const result = ledgerToDate(ANCHOR_LEDGER + 1, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result.getTime()).toBe(ANCHOR_DATE.getTime() + 5_000);
  });

  test("subtracts 5 seconds per ledger in the past", () => {
    const result = ledgerToDate(ANCHOR_LEDGER - 1, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result.getTime()).toBe(ANCHOR_DATE.getTime() - 5_000);
  });

  test("correctly offsets 17,280 ledgers (exactly 1 day ahead)", () => {
    // 17_280 ledgers × 5 s = 86_400 s = 1 day
    const result = ledgerToDate(ANCHOR_LEDGER + 17_280, ANCHOR_LEDGER, ANCHOR_DATE);
    const expectedMs = ANCHOR_DATE.getTime() + 24 * 60 * 60 * 1_000;
    expect(result.getTime()).toBe(expectedMs);
  });

  test("correctly offsets 172,800 ledgers (10 days ahead)", () => {
    const result = ledgerToDate(ANCHOR_LEDGER + 172_800, ANCHOR_LEDGER, ANCHOR_DATE);
    const expectedMs = ANCHOR_DATE.getTime() + 10 * 24 * 60 * 60 * 1_000;
    expect(result.getTime()).toBe(expectedMs);
  });

  test("returns a Date object", () => {
    const result = ledgerToDate(ANCHOR_LEDGER + 100, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result).toBeInstanceOf(Date);
  });

  test("handles large ledger offsets without overflow", () => {
    // ~1 year ≈ 6_307_200 ledgers
    const oneYear = 6_307_200;
    const result = ledgerToDate(ANCHOR_LEDGER + oneYear, ANCHOR_LEDGER, ANCHOR_DATE);
    const expectedMs = ANCHOR_DATE.getTime() + oneYear * 5_000;
    expect(result.getTime()).toBe(expectedMs);
  });
});

// ── dateToLedger ─────────────────────────────────────────────────────────────

describe("dateToLedger", () => {
  const ANCHOR_LEDGER = 1_000_000;
  const ANCHOR_DATE   = new Date("2025-01-01T00:00:00.000Z");

  test("returns the anchor ledger when targetDate === currentTimestamp", () => {
    const result = dateToLedger(new Date(ANCHOR_DATE), ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result).toBe(ANCHOR_LEDGER);
  });

  test("returns anchor + 1 for 5 seconds ahead", () => {
    const target = new Date(ANCHOR_DATE.getTime() + 5_000);
    expect(dateToLedger(target, ANCHOR_LEDGER, ANCHOR_DATE)).toBe(ANCHOR_LEDGER + 1);
  });

  test("returns anchor - 1 for 5 seconds behind", () => {
    const target = new Date(ANCHOR_DATE.getTime() - 5_000);
    expect(dateToLedger(target, ANCHOR_LEDGER, ANCHOR_DATE)).toBe(ANCHOR_LEDGER - 1);
  });

  test("converts exactly 1 day ahead to 17,280 ledgers", () => {
    const oneDayMs = 24 * 60 * 60 * 1_000;
    const target = new Date(ANCHOR_DATE.getTime() + oneDayMs);
    expect(dateToLedger(target, ANCHOR_LEDGER, ANCHOR_DATE)).toBe(ANCHOR_LEDGER + 17_280);
  });

  test("rounds fractional ledgers to nearest integer", () => {
    // 7.5 seconds ahead → 1.5 ledgers → rounds to 2
    const target = new Date(ANCHOR_DATE.getTime() + 7_500);
    expect(dateToLedger(target, ANCHOR_LEDGER, ANCHOR_DATE)).toBe(ANCHOR_LEDGER + 2);
  });

  test("rounds down for less-than-half ledger", () => {
    // 2 seconds ahead → 0.4 ledgers → rounds to 0
    const target = new Date(ANCHOR_DATE.getTime() + 2_000);
    expect(dateToLedger(target, ANCHOR_LEDGER, ANCHOR_DATE)).toBe(ANCHOR_LEDGER);
  });

  test("is approximately the inverse of ledgerToDate", () => {
    const targetLedger = ANCHOR_LEDGER + 50_000;
    const date = ledgerToDate(targetLedger, ANCHOR_LEDGER, ANCHOR_DATE);
    const roundTrip = dateToLedger(date, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(roundTrip).toBe(targetLedger);
  });

  test("returns an integer", () => {
    const target = new Date(ANCHOR_DATE.getTime() + 100_000);
    const result = dateToLedger(target, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ── ledgerDuration ────────────────────────────────────────────────────────────

describe("ledgerDuration", () => {
  test("returns '0 seconds' for 0 ledgers", () => {
    expect(ledgerDuration(0)).toBe("0 seconds");
  });

  test("1 ledger = 5 seconds → '5 seconds'", () => {
    expect(ledgerDuration(1)).toBe("5 seconds");
  });

  test("12 ledgers = 60 seconds → '1 minute'", () => {
    expect(ledgerDuration(12)).toBe("1 minute");
  });

  test("13 ledgers = 65 seconds → '1 minute 5 seconds'", () => {
    expect(ledgerDuration(13)).toBe("1 minute 5 seconds");
  });

  test("720 ledgers = 1 hour → '1 hour'", () => {
    expect(ledgerDuration(720)).toBe("1 hour");
  });

  test("1440 ledgers = 2 hours → '2 hours'", () => {
    expect(ledgerDuration(1440)).toBe("2 hours");
  });

  test("17280 ledgers = 1 day → '1 day'", () => {
    // 17_280 × 5 s = 86_400 s = 24 h
    expect(ledgerDuration(17_280)).toBe("1 day");
  });

  test("120960 ledgers = 7 days → '1 week'", () => {
    // 120_960 × 5 = 604_800 s = 7 days
    expect(ledgerDuration(120_960)).toBe("1 week");
  });

  test("120960 + 17280 = 8 days → '1 week 1 day'", () => {
    expect(ledgerDuration(120_960 + 17_280)).toBe("1 week 1 day");
  });

  test("includes hours when days remain (e.g. 6 days 3 hours)", () => {
    // 6 days = 103_680; 3 hours = 2_160; total = 105_840
    expect(ledgerDuration(105_840)).toBe("6 days 3 hours");
  });

  test("months: 30 days → '1 month'", () => {
    const thirtyDays = 30 * 24 * 3600 / SECONDS_PER_LEDGER;
    expect(ledgerDuration(thirtyDays)).toBe("1 month");
  });

  test("years: 365 days → '1 year'", () => {
    const oneYear = 365 * 24 * 3600 / SECONDS_PER_LEDGER;
    expect(ledgerDuration(oneYear)).toBe("1 year");
  });

  test("treats negative ledger counts as positive (absolute value)", () => {
    expect(ledgerDuration(-17_280)).toBe("1 day");
  });

  test("only returns the two most significant units", () => {
    // Make sure we don't get more than two parts
    const result = ledgerDuration(130_000);
    const partCount = result.split(" ").filter((w) => /^\d+$/.test(w) || w === "1").length;
    // Should have at most 2 numeric tokens
    expect(result.split(" ").length).toBeLessThanOrEqual(5); // e.g. "1 week 2 days"
  });

  test("singular vs plural: 1 day vs 2 days", () => {
    expect(ledgerDuration(17_280)).toBe("1 day");
    expect(ledgerDuration(34_560)).toBe("2 days");
  });

  test("singular vs plural: 1 hour vs 2 hours", () => {
    expect(ledgerDuration(720)).toBe("1 hour");
    expect(ledgerDuration(1_440)).toBe("2 hours");
  });
});

// ── humanInputToLedgers ───────────────────────────────────────────────────────

describe("humanInputToLedgers", () => {
  test("empty input → 0 ledgers", () => {
    expect(humanInputToLedgers({})).toBe(0);
  });

  test("1 day = 17,280 ledgers", () => {
    expect(humanInputToLedgers({ days: 1 })).toBe(17_280);
  });

  test("1 hour = 720 ledgers", () => {
    expect(humanInputToLedgers({ hours: 1 })).toBe(720);
  });

  test("1 minute = 12 ledgers", () => {
    expect(humanInputToLedgers({ minutes: 1 })).toBe(12);
  });

  test("5 seconds = 1 ledger", () => {
    expect(humanInputToLedgers({ seconds: 5 })).toBe(1);
  });

  test("combines days + hours", () => {
    // 1 day (17_280) + 6 hours (4_320) = 21_600
    expect(humanInputToLedgers({ days: 1, hours: 6 })).toBe(21_600);
  });

  test("combines all units", () => {
    // 1 d = 86400 s, 2 h = 7200 s, 30 min = 1800 s, 10 s = 10 s → total = 95410 s / 5 = 19082
    expect(humanInputToLedgers({ days: 1, hours: 2, minutes: 30, seconds: 10 })).toBe(19_082);
  });

  test("7 days = 120,960 ledgers", () => {
    expect(humanInputToLedgers({ days: 7 })).toBe(120_960);
  });

  test("30 days = 518,400 ledgers", () => {
    expect(humanInputToLedgers({ days: 30 })).toBe(518_400);
  });

  test("negative values clamp to 0", () => {
    expect(humanInputToLedgers({ days: -5 })).toBe(0);
  });

  test("fractional seconds rounds to nearest ledger", () => {
    // 7 seconds → 1.4 ledgers → rounds to 1
    expect(humanInputToLedgers({ seconds: 7 })).toBe(1);
    // 8 seconds → 1.6 ledgers → rounds to 2
    expect(humanInputToLedgers({ seconds: 8 })).toBe(2);
  });

  test("returns an integer", () => {
    const result = humanInputToLedgers({ hours: 3, minutes: 17 });
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ── formatLedgerWithTime ──────────────────────────────────────────────────────

describe("formatLedgerWithTime", () => {
  const ANCHOR_LEDGER = 1_000_000;
  const ANCHOR_DATE   = new Date("2025-01-01T00:00:00.000Z");

  test("returns an object with ledger, estimatedDate, and label fields", () => {
    const result = formatLedgerWithTime(ANCHOR_LEDGER, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result).toHaveProperty("ledger");
    expect(result).toHaveProperty("estimatedDate");
    expect(result).toHaveProperty("label");
  });

  test("ledger field matches the input targetLedger", () => {
    const result = formatLedgerWithTime(ANCHOR_LEDGER + 100, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result.ledger).toBe(ANCHOR_LEDGER + 100);
  });

  test("estimatedDate is a Date instance", () => {
    const result = formatLedgerWithTime(ANCHOR_LEDGER, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result.estimatedDate).toBeInstanceOf(Date);
  });

  test("estimatedDate matches ledgerToDate output", () => {
    const target = ANCHOR_LEDGER + 17_280;
    const result = formatLedgerWithTime(target, ANCHOR_LEDGER, ANCHOR_DATE);
    const direct = ledgerToDate(target, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result.estimatedDate.getTime()).toBe(direct.getTime());
  });

  test("label starts with 'ledger '", () => {
    const result = formatLedgerWithTime(ANCHOR_LEDGER, ANCHOR_LEDGER, ANCHOR_DATE);
    expect(result.label).toMatch(/^ledger /);
  });

  test("label contains the target ledger number", () => {
    const result = formatLedgerWithTime(1_234_567, ANCHOR_LEDGER, ANCHOR_DATE);
    // The number should appear formatted in the label
    expect(result.label).toContain("1,234,567");
  });

  test("label contains estimated date in parentheses", () => {
    const result = formatLedgerWithTime(ANCHOR_LEDGER, ANCHOR_LEDGER, ANCHOR_DATE, "en-US");
    // Should contain "(~..." pattern
    expect(result.label).toMatch(/\(~.+\)/);
  });

  test("same ledger as anchor has anchor date in label", () => {
    const result = formatLedgerWithTime(ANCHOR_LEDGER, ANCHOR_LEDGER, ANCHOR_DATE, "en-US");
    expect(result.estimatedDate.getTime()).toBe(ANCHOR_DATE.getTime());
  });
});

// ── Round-trip consistency ────────────────────────────────────────────────────

describe("round-trip: ledgerToDate → dateToLedger", () => {
  const ANCHOR_LEDGER = 500_000;
  const ANCHOR_DATE   = new Date("2024-06-15T12:00:00.000Z");

  const CASES = [
    { label: "cliff at 30 days",   ledger: ANCHOR_LEDGER + humanInputToLedgers({ days: 30 }) },
    { label: "end at 1 year",      ledger: ANCHOR_LEDGER + humanInputToLedgers({ days: 365 }) },
    { label: "1 hour from anchor", ledger: ANCHOR_LEDGER + humanInputToLedgers({ hours: 1 }) },
  ];

  for (const { label, ledger } of CASES) {
    test(`round-trips correctly: ${label}`, () => {
      const date      = ledgerToDate(ledger, ANCHOR_LEDGER, ANCHOR_DATE);
      const backAgain = dateToLedger(date, ANCHOR_LEDGER, ANCHOR_DATE);
      expect(backAgain).toBe(ledger);
    });
  }
});
