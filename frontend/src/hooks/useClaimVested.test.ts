import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useClaimVested,
  parseContractErrorCode,
  buildErrorMessage,
  submitWithRetry,
} from "@/hooks/useClaimVested";

// ── parseContractErrorCode ────────────────────────────────────────────────────

describe("parseContractErrorCode", () => {
  it("parses Soroban SDK format 'Error(Contract, #7)'", () => {
    expect(parseContractErrorCode(new Error("Error(Contract, #7)"))).toBe(7);
  });

  it("parses 'Error(Contract, #2)' (CliffNotReached)", () => {
    expect(parseContractErrorCode(new Error("Error(Contract, #2)"))).toBe(2);
  });

  it("parses 'contract error: 7'", () => {
    expect(parseContractErrorCode(new Error("contract error: 7"))).toBe(7);
  });

  it("parses 'VestingError(7)'", () => {
    expect(parseContractErrorCode(new Error("VestingError(7)"))).toBe(7);
  });

  it("returns null for an unrecognised error string", () => {
    expect(parseContractErrorCode(new Error("something went wrong"))).toBeNull();
  });

  it("handles plain string input", () => {
    expect(parseContractErrorCode("Error(Contract, #3)")).toBe(3);
  });

  it("handles non-Error objects gracefully", () => {
    expect(parseContractErrorCode({ status: 504 })).toBeNull();
  });
});

// ── buildErrorMessage ─────────────────────────────────────────────────────────

describe("buildErrorMessage", () => {
  it("maps code 2 to CliffNotReached message", () => {
    const err = new Error("Error(Contract, #2)");
    const { message, code } = buildErrorMessage(err);
    expect(code).toBe(2);
    expect(message).toMatch(/cliff not reached/i);
  });

  it("maps code 7 to NothingToClaim message", () => {
    const err = new Error("Error(Contract, #7)");
    const { message, code } = buildErrorMessage(err);
    expect(code).toBe(7);
    expect(message).toMatch(/nothing to claim/i);
  });

  it("returns unknown error for unmapped code 99", () => {
    const err = new Error("Error(Contract, #99)");
    const { message, code } = buildErrorMessage(err);
    expect(code).toBe(99);
    expect(message).toMatch(/unexpected error/i);
  });

  it("detects user rejection", () => {
    const { message, code } = buildErrorMessage(new Error("User denied signing"));
    expect(code).toBeNull();
    expect(message).toMatch(/cancelled/i);
  });

  it("detects network errors", () => {
    const { message, code } = buildErrorMessage(new Error("Network error: failed to fetch"));
    expect(code).toBeNull();
    expect(message).toMatch(/network error/i);
  });

  it("falls back to raw message for unknown errors", () => {
    const { message, code } = buildErrorMessage(new Error("Some other error"));
    expect(code).toBeNull();
    expect(message).toBe("Some other error");
  });
});

// ── submitWithRetry ───────────────────────────────────────────────────────────

describe("submitWithRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue({ hash: "abc123" });
    await expect(submitWithRetry(fn, 3)).resolves.toEqual({ hash: "abc123" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 504 and succeeds on second attempt", async () => {
    // Use real timers but mock the internal sleep to be immediate
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("504 Gateway Timeout"))
      .mockResolvedValueOnce({ hash: "ok" });

    const resultPromise = submitWithRetry(fn, 3);
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toEqual({ hash: "ok" });
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("retries on 'timed out' keyword", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Request timed out"))
      .mockResolvedValueOnce({ hash: "ok" });

    const resultPromise = submitWithRetry(fn, 3);
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toEqual({ hash: "ok" });
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws after exhausting retries on repeated 504", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("504 Gateway Timeout"))
      .mockRejectedValueOnce(new Error("504 Gateway Timeout"))
      .mockRejectedValueOnce(new Error("504 Gateway Timeout"));

    const resultPromise = submitWithRetry(fn, 2).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/504/);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    vi.useRealTimers();
  });

  it("does not retry on non-504 errors", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValueOnce(new Error("Unauthorized"));
    const resultPromise = submitWithRetry(fn, 3).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    const result = await resultPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/Unauthorized/);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// ── useClaimVested hook ───────────────────────────────────────────────────────

describe("useClaimVested", () => {
  const recipient = "GABC1234";

  it("starts in idle phase", () => {
    const claimFn = vi.fn();
    const { result } = renderHook(() =>
      useClaimVested({ claimFn, recipient })
    );
    expect(result.current.state.phase).toBe("idle");
    expect(result.current.state.amountClaimed).toBeNull();
    expect(result.current.state.errorMessage).toBeNull();
  });

  it("transitions to success phase on resolved claim", async () => {
    const claimFn = vi.fn().mockResolvedValue(1500);
    const { result } = renderHook(() =>
      useClaimVested({ claimFn, recipient })
    );

    await act(async () => {
      await result.current.claim();
    });

    expect(result.current.state.phase).toBe("success");
    expect(result.current.state.amountClaimed).toBe(1500);
  });

  it("calls onSuccess callback with claimed amount", async () => {
    const claimFn = vi.fn().mockResolvedValue(750);
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useClaimVested({ claimFn, recipient, onSuccess })
    );

    await act(async () => {
      await result.current.claim();
    });

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith(750);
  });

  it("transitions to error phase on rejected claim", async () => {
    const claimFn = vi.fn().mockRejectedValue(new Error("Error(Contract, #2)"));
    const { result } = renderHook(() =>
      useClaimVested({ claimFn, recipient })
    );

    await act(async () => {
      await result.current.claim();
    });

    expect(result.current.state.phase).toBe("error");
    expect(result.current.state.errorMessage).toMatch(/cliff not reached/i);
    expect(result.current.state.errorCode).toBe(2);
  });

  it("sets human-readable error for user rejection", async () => {
    const claimFn = vi.fn().mockRejectedValue(new Error("User rejected"));
    const { result } = renderHook(() =>
      useClaimVested({ claimFn, recipient })
    );

    await act(async () => {
      await result.current.claim();
    });

    expect(result.current.state.phase).toBe("error");
    expect(result.current.state.errorMessage).toMatch(/cancelled/i);
    expect(result.current.state.errorCode).toBeNull();
  });

  it("resets back to idle via reset()", async () => {
    const claimFn = vi.fn().mockResolvedValue(500);
    const { result } = renderHook(() =>
      useClaimVested({ claimFn, recipient })
    );

    await act(async () => {
      await result.current.claim();
    });
    expect(result.current.state.phase).toBe("success");

    act(() => {
      result.current.reset();
    });
    expect(result.current.state.phase).toBe("idle");
  });

  it("does not double-submit when claim is called during signing phase", async () => {
    let resolveFirst!: (v: number) => void;
    const claimFn = vi.fn().mockImplementation(
      () => new Promise<number>((res) => { resolveFirst = res; })
    );
    const { result } = renderHook(() =>
      useClaimVested({ claimFn, recipient })
    );

    // Start first claim without awaiting
    act(() => { result.current.claim(); });

    // Attempt second claim — should be ignored
    act(() => { result.current.claim(); });

    act(() => { resolveFirst(100); });

    // Only one call to claimFn
    expect(claimFn).toHaveBeenCalledTimes(1);
  });

  it("passes the recipient address to claimFn", async () => {
    const claimFn = vi.fn().mockResolvedValue(0);
    const { result } = renderHook(() =>
      useClaimVested({ claimFn, recipient: "GTEST999" })
    );

    await act(async () => {
      await result.current.claim();
    });

    expect(claimFn).toHaveBeenCalledWith("GTEST999");
  });

  it("allows retry from error phase", async () => {
    const claimFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error: failed to fetch"))
      .mockResolvedValue(300);

    const { result } = renderHook(() =>
      useClaimVested({ claimFn, recipient })
    );

    // First attempt → error
    await act(async () => {
      await result.current.claim();
    });
    expect(result.current.state.phase).toBe("error");

    // Second attempt from error state → success
    await act(async () => {
      await result.current.claim();
    });
    expect(result.current.state.phase).toBe("success");
    expect(result.current.state.amountClaimed).toBe(300);
  });
});
