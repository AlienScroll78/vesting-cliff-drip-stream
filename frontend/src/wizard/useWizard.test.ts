import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { isDepositOverflow, ledgersToDuration, I128_MAX, useWizard } from "./useWizard";

describe("isDepositOverflow", () => {
  it("returns false for small values", () => {
    expect(isDepositOverflow(10, 172_800)).toBe(false);
  });

  it("returns false for a value well within i128 range", () => {
    // rate=10, total=1_000_000 → 10M, trivially within i128
    expect(isDepositOverflow(10, 1_000_000)).toBe(false);
  });

  it("returns true when rate * total exceeds i128::MAX", () => {
    // Use a rate that forces overflow with a large total
    // i128::MAX ≈ 1.7e38; two large numbers easily overflow
    const bigRate  = Number(I128_MAX) / 2 + 1;
    const bigTotal = 3;
    expect(isDepositOverflow(bigRate, bigTotal)).toBe(true);
  });

  it("returns false for zero rate", () => {
    expect(isDepositOverflow(0, 172_800)).toBe(false);
  });

  it("returns false for zero duration", () => {
    expect(isDepositOverflow(10, 0)).toBe(false);
  });
});

describe("ledgersToDuration", () => {
  it("converts seconds", () => {
    expect(ledgersToDuration(10)).toBe("50s"); // 10 / 0.2 = 50s
  });

  it("converts minutes", () => {
    expect(ledgersToDuration(120)).toBe("10m"); // 120 / 0.2 = 600s = 10m
  });

  it("converts hours", () => {
    expect(ledgersToDuration(720)).toBe("1h"); // 720 / 0.2 = 3600s = 1h
  });

  it("converts days (~1 day = 17280 ledgers)", () => {
    expect(ledgersToDuration(17_280)).toBe("1d");
  });

  it("converts years (~1 year = 6307200 ledgers)", () => {
    // 365 * 86400 / 5 = 6307200
    const oneYear = Math.round((365 * 86400) / 5);
    const result = ledgersToDuration(oneYear);
    expect(result).toMatch(/yr/);
  });
});

// ── Progress persistence (#822) ───────────────────────────────────────────────

describe("useWizard — progress persistence", () => {
  const STORAGE_KEY = "vesting_wizard_progress";

  beforeEach(() => {
    localStorage.clear();
    window.location.hash = "";
  });

  it("restores saved form data on mount", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        stepIndex: 1,
        data: {
          recipient: "GABC",
          tokenAddress: "CDEF",
          tokenSymbol: "USDC",
          rate: "10",
          cliffDuration: "17280",
          totalDuration: "172800",
          walletAddress: "GWALLET",
        },
      })
    );

    const { result } = renderHook(() => useWizard());
    expect(result.current.data.recipient).toBe("GABC");
    expect(result.current.data.rate).toBe("10");
    expect(result.current.stepIndex).toBe(1);
    expect(result.current.step).toBe("token");
  });

  it("saves form state to localStorage as the user types", () => {
    const { result } = renderHook(() => useWizard());
    act(() => {
      result.current.update({ recipient: "GTEST" });
    });

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.data.recipient).toBe("GTEST");
  });

  it("survives a simulated browser close and reopen", () => {
    // First session: user fills in the recipient, then "closes the browser".
    const first = renderHook(() => useWizard());
    act(() => {
      first.result.current.update({ recipient: "GPERSIST" });
    });
    first.unmount();

    // Second session: a fresh hook picks the draft back up.
    const second = renderHook(() => useWizard());
    expect(second.result.current.data.recipient).toBe("GPERSIST");
  });

  it("restores the furthest step reached", () => {
    const { result } = renderHook(() => useWizard());
    act(() => { result.current.next(); });
    expect(result.current.furthestStep).toBe(1);

    act(() => { result.current.back(); });
    // Going back doesn't lower the high-water mark, so the checkmark stays.
    expect(result.current.furthestStep).toBe(1);
  });

  it("clears the saved draft on reset", () => {
    const { result } = renderHook(() => useWizard());
    act(() => {
      result.current.update({ recipient: "GTEMP" });
    });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    act(() => { result.current.reset(); });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.data.recipient).toBe("");
    expect(result.current.furthestStep).toBe(0);
  });

  it("ignores a corrupt saved draft instead of crashing", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(() => renderHook(() => useWizard())).not.toThrow();
  });

  it("ignores an out-of-range saved step index", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ stepIndex: 99, data: { recipient: "G" } })
    );
    const { result } = renderHook(() => useWizard());
    expect(result.current.stepIndex).toBe(0);
  });
});

// ── Step navigation guards (#822) ─────────────────────────────────────────────

describe("useWizard — goToStep", () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = "";
  });

  it("clamps forward jumps to the current step", () => {
    const { result } = renderHook(() => useWizard());
    act(() => { result.current.goToStep(3); });
    // Forward navigation is gated by each step's own validation.
    expect(result.current.stepIndex).toBe(0);
  });

  it("allows jumping back to a completed step", () => {
    const { result } = renderHook(() => useWizard());
    act(() => { result.current.next(); });
    act(() => { result.current.next(); });
    expect(result.current.stepIndex).toBe(2);

    act(() => { result.current.goToStep(0); });
    expect(result.current.stepIndex).toBe(0);
  });

  it("never goes below step 0", () => {
    const { result } = renderHook(() => useWizard());
    act(() => { result.current.goToStep(-3); });
    expect(result.current.stepIndex).toBe(0);
  });
});
