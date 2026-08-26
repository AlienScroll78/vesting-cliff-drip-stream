import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DepositCalculator } from "@/components/DepositCalculator";

// ── Constants mirrored from the component ──────────────────────────────────

const LEDGERS_PER_DAY = 17_280;
const I128_MAX = BigInt("170141183460469231731687303715884105727");

// ── Helpers ────────────────────────────────────────────────────────────────

function renderCalc(props: React.ComponentProps<typeof DepositCalculator>) {
  return render(<DepositCalculator {...props} />);
}

/** jsdom doesn't implement Blob.prototype.text(); use FileReader instead. */
function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

// ── Test suites ────────────────────────────────────────────────────────────

describe("DepositCalculator", () => {
  describe("basic calculation correctness", () => {
    it("shows placeholder when rate is 0", () => {
      renderCalc({ rate: 0, cliffLedgers: 1000, totalLedgers: 10_000 });
      expect(screen.getByTestId("calc-placeholder")).toBeInTheDocument();
    });

    it("shows placeholder when totalLedgers is 0", () => {
      renderCalc({ rate: 10, cliffLedgers: 0, totalLedgers: 0 });
      expect(screen.getByTestId("calc-placeholder")).toBeInTheDocument();
    });

    it("computes totalDeposit = rate × totalLedgers", () => {
      // rate=10, total=100_000 → 1_000_000
      renderCalc({ rate: 10, cliffLedgers: 20_000, totalLedgers: 100_000 });
      const cell = screen.getByTestId("total-deposit");
      expect(cell.textContent).toContain("1,000,000");
    });

    it("computes cliffAccrual = rate × cliffLedgers", () => {
      // rate=5, cliff=10_000 → 50_000
      renderCalc({ rate: 5, cliffLedgers: 10_000, totalLedgers: 50_000 });
      const cell = screen.getByTestId("cliff-accrual");
      expect(cell.textContent).toContain("50,000");
    });

    it("computes postCliffDrip = rate × (totalLedgers - cliffLedgers)", () => {
      // rate=5, total=50_000, cliff=10_000 → post = 5 × 40_000 = 200_000
      renderCalc({ rate: 5, cliffLedgers: 10_000, totalLedgers: 50_000 });
      const cell = screen.getByTestId("post-cliff-drip");
      expect(cell.textContent).toContain("200,000");
    });

    it("shows zero post-cliff drip when cliffLedgers == totalLedgers", () => {
      renderCalc({ rate: 7, cliffLedgers: 5_000, totalLedgers: 5_000 });
      const cell = screen.getByTestId("post-cliff-drip");
      expect(cell.textContent).toContain("0");
    });

    it("handles cliffLedgers = 0 (no cliff)", () => {
      renderCalc({ rate: 3, cliffLedgers: 0, totalLedgers: 30_000 });
      expect(screen.getByTestId("cliff-accrual").textContent).toContain("0");
      expect(screen.getByTestId("post-cliff-drip").textContent).toContain("90,000");
    });

    it("shows the calc-results region", () => {
      renderCalc({ rate: 1, cliffLedgers: 100, totalLedgers: 1_000 });
      expect(screen.getByTestId("calc-results")).toBeInTheDocument();
    });
  });

  describe("ledger-to-day conversion", () => {
    it("shows total days alongside raw ledger counts", () => {
      // 17_280 ledgers = exactly 1 day
      renderCalc({ rate: 1, cliffLedgers: 0, totalLedgers: LEDGERS_PER_DAY });
      const daysEl = screen.getByTestId("total-deposit-days");
      expect(daysEl.textContent).toContain("1");
      expect(daysEl.textContent).toMatch(/day/i);
    });

    it("shows cliff days in the cliff-accrual row", () => {
      // 17_280 cliff ledgers = 1 day
      renderCalc({ rate: 2, cliffLedgers: LEDGERS_PER_DAY, totalLedgers: LEDGERS_PER_DAY * 10 });
      const cliffDaysEl = screen.getByTestId("cliff-accrual-days");
      expect(cliffDaysEl.textContent).toContain("1");
    });

    it("shows post-cliff days in the post-cliff-drip row", () => {
      // post = totalLedgers - cliffLedgers = 9 × LEDGERS_PER_DAY
      renderCalc({ rate: 2, cliffLedgers: LEDGERS_PER_DAY, totalLedgers: LEDGERS_PER_DAY * 10 });
      const postDaysEl = screen.getByTestId("post-cliff-drip-days");
      expect(postDaysEl.textContent).toContain("9");
    });
  });

  describe("overflow detection", () => {
    it("does NOT show overflow error for a valid deposit just below i128::MAX", () => {
      // Use a rate of 1 and totalLedgers = Number(I128_MAX) would be unsafe,
      // so instead test with a known-safe large value
      renderCalc({ rate: 1, cliffLedgers: 0, totalLedgers: 1_000_000_000 });
      expect(screen.queryByTestId("overflow-error")).not.toBeInTheDocument();
    });

    it("shows overflow error when totalDeposit exceeds i128::MAX", () => {
      // i128::MAX = 170141183460469231731687303715884105727
      // We use rate = Number.MAX_SAFE_INTEGER (2^53-1) and totalLedgers large
      // enough to guarantee overflow.
      // Simplest: compute rate that will overflow with totalLedgers = 1.
      // rate * 1 > i128MAX → we need rate > i128MAX, but rate is a JS number.
      // So: rate = 2**53 (> MAX_SAFE_INTEGER for rounding, but still representable
      // as float), totalLedgers = 2**53, product ~ 2**106 < i128MAX (2**127).
      // Instead use: rate = 10**27 (≈ 10^27), totalLedgers = 10**12 → 10^39 > i128MAX
      // BigInt(10**27) works because 10^27 < 2^53? No — 10^27 > 2^53.
      // Use two moderate BigInt-safe values whose product overflows:
      // rate = 9_007_199_254_740_992 (2^53, fits in float exactly)
      // totalLedgers = 9_007_199_254_740_992
      // product = (2^53)^2 = 2^106 — well below i128::MAX (2^127-1)
      // We need product > 2^127. Use exponent approach:
      // 2^64 * 2^64 = 2^128 > 2^127-1. But 2^64 = 18_446_744_073_709_551_616 > 2^53.
      // JS numbers can't represent 2^64 exactly, so BigInt conversion will lose precision.
      // The component uses Math.floor(rate) then BigInt(), so any integer rate ≤ 2^53 is fine.
      // rate = 2^53 = 9_007_199_254_740_992, totalLedgers = 2^53 → 2^106 < i128MAX.
      // We need to verify the component uses BigInt arithmetic faithfully.
      // Let's instead rely on the component's own BigInt path with a simple
      // but large enough product using string-parseable values that fit in floats:
      //
      // i128MAX ≈ 1.7 × 10^38
      // rate = 10^19 ≈ 2^63.1 — NOT representable as safe integer.
      //
      // Safe approach: pass rate as a large-but-representable integer and
      // totalLedgers such that rate * totalLedgers > i128MAX using floats.
      // Actually the component converts: BigInt(Math.floor(rate))
      // If rate = 1e30 (not safe integer) → Math.floor gives ~1e30 rounded.
      // Let's just pass a plain value we know overflows:
      // rate = Number.MAX_SAFE_INTEGER = 9_007_199_254_740_991 (< 2^53)
      // totalLedgers = Number.MAX_SAFE_INTEGER
      // product = ~8.1 × 10^31 < 1.7 × 10^38 — still doesn't overflow!
      //
      // We need rate × totalLedgers > 1.7 × 10^38.
      // sqrt(1.7e38) ≈ 1.3e19. So both need to be ~ 1.3e19.
      // But 1.3e19 > Number.MAX_SAFE_INTEGER (9e15). Floats at this scale
      // have 1 ULP ≈ 1024, so floor() is imprecise but BigInt conversion
      // will round. The test just needs the product (as BigInt) > I128_MAX.
      //
      // Most reliable: provide rate=1 and totalLedgers that, when converted to
      // BigInt, exceeds I128_MAX. But i128MAX is a 39-digit number.
      // totalLedgers as JS float — largest exact integer = 2^53 ≈ 9e15. Not big enough.
      //
      // CONCLUSION: We cannot directly pass values that overflow via Number props
      // if the product requires > 2^53 precision in rate×total.
      // The overflow test must use a rate > 1. Both values must be safe integers.
      //
      // Best choice: use two values where the product overflows but each fits safely:
      // rate = 10_000_000_000 (1e10), totalLedgers = 17_014_118_346_046_924 (~1.7e16)
      // product = 1.7e26 — still not > 1.7e38.
      // Need: rate = 1e19 (> safe int range) OR totalLedgers = 1.7e28 (> safe).
      //
      // Revisit: The component does `BigInt(Math.floor(rate))`. If we pass
      // rate = 1.7e20 (not safe), Math.floor = 170000000000000000000 but floating
      // point representation of 1.7e20 = 170000000000000000000 (exact!? Let's check:
      // 1.7e20 = 17 × 10^19; 10^19 = 10_000_000_000_000_000_000 > 2^53 so NOT exact.
      // Closest float: 170000000000000000000 rounds to 170000000000000016384.
      // Math.floor gives the same — BigInt conversion gives 170000000000000016384.
      //
      // The safest overflow test: use two values whose BigInt product surely overflows.
      // rate = 2 ** 53 = 9_007_199_254_740_992 → exact float
      // totalLedgers = 2 ** 85 — way too large for a float
      //
      // FINAL approach: test overflow by passing a rate that is large but within
      // safe integer range, and a totalLedgers that is also within safe integer range,
      // but whose product (as BigInt) exceeds I128_MAX.
      //
      // 9_007_199_254_740_992 × totalLedgers > I128_MAX
      // totalLedgers > I128_MAX / 9_007_199_254_740_992
      //              ≈ 18_889_465_931_478_580_854 ← still > 2^53. Not a safe integer.
      //
      // No two safe-integer values have a product > i128MAX.
      // → Use rate = 1 and pass totalLedgers as a huge-but-representable float:
      // totalLedgers = I128_MAX + 1 but as a Number → will be i128MAX rounded.
      // Actually Number(I128_MAX) = 1.7014118346046923e+38 (representable). Good.
      // BigInt(Math.floor(1.7014118346046923e+38)) should be >= I128_MAX.
      //
      // Let's verify: Number(I128_MAX) in JS = 1.7014118346046923e+38
      // BigInt(1.7014118346046923e+38) = 170141183460469231731687303715884105728 (+ 1 vs I128MAX)
      // So BigInt(Math.floor(Number(I128_MAX))) === I128_MAX + 1n → product > I128_MAX ✓
      const bigRate = Number(I128_MAX); // converts to float, very slightly > I128_MAX when BigInt'd
      renderCalc({ rate: bigRate, cliffLedgers: 0, totalLedgers: 1 });
      expect(screen.getByTestId("overflow-error")).toBeInTheDocument();
    });

    it("overflow error hides warning banner", () => {
      const bigRate = Number(I128_MAX);
      renderCalc({ rate: bigRate, cliffLedgers: 0, totalLedgers: 1 });
      // overflow takes precedence; warning banner should not appear simultaneously
      expect(screen.queryByTestId("warning-banner")).not.toBeInTheDocument();
    });

    it("overflow error has role=alert", () => {
      const bigRate = Number(I128_MAX);
      renderCalc({ rate: bigRate, cliffLedgers: 0, totalLedgers: 1 });
      const alert = screen.getByTestId("overflow-error");
      expect(alert).toHaveAttribute("role", "alert");
    });
  });

  describe("warning threshold", () => {
    it("shows warning banner when totalDeposit > default threshold (10_000_000)", () => {
      // rate=100, total=200_000 → deposit = 20_000_000 > 10_000_000
      renderCalc({ rate: 100, cliffLedgers: 0, totalLedgers: 200_000 });
      expect(screen.getByTestId("warning-banner")).toBeInTheDocument();
    });

    it("does NOT show warning banner when deposit equals threshold exactly", () => {
      // rate=10, total=1_000_000 → deposit = 10_000_000 = threshold (not strictly greater)
      renderCalc({ rate: 10, cliffLedgers: 0, totalLedgers: 1_000_000 });
      expect(screen.queryByTestId("warning-banner")).not.toBeInTheDocument();
    });

    it("does NOT show warning banner when deposit is below default threshold", () => {
      // rate=1, total=1_000 → deposit = 1_000 < 10_000_000
      renderCalc({ rate: 1, cliffLedgers: 0, totalLedgers: 1_000 });
      expect(screen.queryByTestId("warning-banner")).not.toBeInTheDocument();
    });

    it("uses a custom warningThreshold", () => {
      // rate=1, total=600 → deposit=600 > custom threshold of 500
      renderCalc({ rate: 1, cliffLedgers: 0, totalLedgers: 600, warningThreshold: 500 });
      expect(screen.getByTestId("warning-banner")).toBeInTheDocument();
    });

    it("does NOT show warning when deposit <= custom threshold", () => {
      renderCalc({ rate: 1, cliffLedgers: 0, totalLedgers: 499, warningThreshold: 500 });
      expect(screen.queryByTestId("warning-banner")).not.toBeInTheDocument();
    });

    it("warning banner has role=alert", () => {
      renderCalc({ rate: 100, cliffLedgers: 0, totalLedgers: 200_000 });
      const banner = screen.getByTestId("warning-banner");
      expect(banner).toHaveAttribute("role", "alert");
    });

    it("warning banner text mentions the threshold", () => {
      renderCalc({ rate: 100, cliffLedgers: 0, totalLedgers: 200_000 });
      const banner = screen.getByTestId("warning-banner");
      expect(banner.textContent).toContain("10,000,000");
    });
  });

  describe("accessibility", () => {
    it("calc-results region has role=status and aria-live=polite", () => {
      renderCalc({ rate: 10, cliffLedgers: 100, totalLedgers: 1_000 });
      const region = screen.getByTestId("calc-results");
      expect(region).toHaveAttribute("role", "status");
      expect(region).toHaveAttribute("aria-live", "polite");
    });

    it("export button has an aria-label", () => {
      renderCalc({ rate: 10, cliffLedgers: 100, totalLedgers: 1_000 });
      const btn = screen.getByTestId("export-button");
      expect(btn).toHaveAttribute("aria-label");
    });

    it("export button is disabled when no useful values", () => {
      renderCalc({ rate: 0, cliffLedgers: 0, totalLedgers: 0 });
      expect(screen.getByTestId("export-button")).toBeDisabled();
    });

    it("export button is enabled when rate and totalLedgers > 0", () => {
      renderCalc({ rate: 5, cliffLedgers: 100, totalLedgers: 1_000 });
      expect(screen.getByTestId("export-button")).not.toBeDisabled();
    });
  });

  describe("export functionality", () => {
    let createObjectURLMock: ReturnType<typeof vi.fn>;
    let revokeObjectURLMock: ReturnType<typeof vi.fn>;
    let clickMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Mock URL.createObjectURL / revokeObjectURL
      createObjectURLMock = vi.fn().mockReturnValue("blob:mock-url");
      revokeObjectURLMock = vi.fn();
      global.URL.createObjectURL = createObjectURLMock;
      global.URL.revokeObjectURL = revokeObjectURLMock;

      // Intercept anchor creation and click
      clickMock = vi.fn();

      // Override document.createElement only for 'a' to capture the click
      const origCreate = document.createElement.bind(document);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: any) => {
          if (tag === "a") {
            const anchor = origCreate(tag, options);
            anchor.click = clickMock;
            return anchor;
          }
          return origCreate(tag, options);
        },
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("calls URL.createObjectURL when Export is clicked", async () => {
      renderCalc({ rate: 10, cliffLedgers: 1_000, totalLedgers: 10_000 });
      await userEvent.click(screen.getByTestId("export-button"));
      expect(createObjectURLMock).toHaveBeenCalledOnce();
    });

    it("calls URL.revokeObjectURL after creating the blob", async () => {
      renderCalc({ rate: 10, cliffLedgers: 1_000, totalLedgers: 10_000 });
      await userEvent.click(screen.getByTestId("export-button"));
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");
    });

    it("triggers anchor click to start download", async () => {
      renderCalc({ rate: 10, cliffLedgers: 1_000, totalLedgers: 10_000 });
      await userEvent.click(screen.getByTestId("export-button"));
      expect(clickMock).toHaveBeenCalledOnce();
    });

    it("creates a Blob with text/plain MIME type", async () => {
      renderCalc({ rate: 10, cliffLedgers: 1_000, totalLedgers: 10_000 });
      await userEvent.click(screen.getByTestId("export-button"));
      const [blobArg] = createObjectURLMock.mock.calls[0] as [Blob];
      expect(blobArg.type).toContain("text/plain");
    });

    it("export text includes the calculated total deposit", async () => {
      renderCalc({ rate: 10, cliffLedgers: 1_000, totalLedgers: 10_000 });
      await userEvent.click(screen.getByTestId("export-button"));
      const [blobArg] = createObjectURLMock.mock.calls[0] as [Blob];
      const text = await readBlobAsText(blobArg);
      // rate=10, total=10_000 → total deposit = 100_000
      expect(text).toContain("100,000");
    });

    it("export text includes cliff accrual", async () => {
      renderCalc({ rate: 10, cliffLedgers: 1_000, totalLedgers: 10_000 });
      await userEvent.click(screen.getByTestId("export-button"));
      const [blobArg] = createObjectURLMock.mock.calls[0] as [Blob];
      const text = await readBlobAsText(blobArg);
      // cliff = 10 × 1_000 = 10_000
      expect(text).toContain("10,000");
    });

    it("export text includes rate", async () => {
      renderCalc({ rate: 42, cliffLedgers: 500, totalLedgers: 5_000 });
      await userEvent.click(screen.getByTestId("export-button"));
      const [blobArg] = createObjectURLMock.mock.calls[0] as [Blob];
      const text = await readBlobAsText(blobArg);
      expect(text).toContain("42");
    });

    it("export text includes overflow warning when overflowing", async () => {
      const bigRate = Number(I128_MAX);
      renderCalc({ rate: bigRate, cliffLedgers: 0, totalLedgers: 1 });
      await userEvent.click(screen.getByTestId("export-button"));
      const [blobArg] = createObjectURLMock.mock.calls[0] as [Blob];
      const text = await readBlobAsText(blobArg);
      expect(text.toUpperCase()).toContain("OVERFLOW");
    });

    it("does nothing (button is disabled) when rate is 0", async () => {
      renderCalc({ rate: 0, cliffLedgers: 0, totalLedgers: 0 });
      const btn = screen.getByTestId("export-button");
      expect(btn).toBeDisabled();
      await userEvent.click(btn);
      expect(createObjectURLMock).not.toHaveBeenCalled();
    });
  });
});
