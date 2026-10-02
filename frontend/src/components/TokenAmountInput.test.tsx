import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  abbreviateTokenAmount,
  formatTokenAmount,
  I128_MAX,
  parseTokenAmount,
  TOKEN_SCALE,
} from "@/utils/tokenAmount";
import { TokenAmountInput } from "@/components/TokenAmountInput";

describe("token amount utilities", () => {
  it("parses and formats large values without a floating point conversion", () => {
    const value = BigInt("100000000000000000");
    expect(parseTokenAmount("100000000000000000", "en-US")).toBe(value * TOKEN_SCALE);
    expect(formatTokenAmount(value * TOKEN_SCALE, "en-US")).toBe("100,000,000,000,000,000");
  });

  it("uses the locale decimal separator", () => {
    expect(formatTokenAmount(TOKEN_SCALE, "en-US")).toBe("1");
    expect(formatTokenAmount(TOKEN_SCALE + BigInt(1), "en-US")).toBe("1.0000001");
    expect(formatTokenAmount(TOKEN_SCALE + BigInt(1), "de-DE")).toBe("1,0000001");
    expect(parseTokenAmount("17014118346046923173168730371588.4105727", "en-US")).toBe(I128_MAX);
  });

  it("abbreviates large values", () => {
    expect(abbreviateTokenAmount(BigInt("15000000000000000"))).toBe("1.5B");
    expect(abbreviateTokenAmount(BigInt("2500000000000000"))).toBe("250M");
    expect(abbreviateTokenAmount(BigInt("450000000000"))).toBe("45K");
  });
});

describe("TokenAmountInput", () => {
  it("emits a BigInt for a large entered amount", async () => {
    const onChange = vi.fn();
    render(<TokenAmountInput label="Amount" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Amount" });

    await userEvent.type(input, "100000000000000000");

    expect(onChange).toHaveBeenLastCalledWith(BigInt("1000000000000000000000000"));
    expect(typeof onChange.mock.calls.at(-1)?.[0]).toBe("bigint");
  });

  it("accepts the locale decimal separator and returns base units", async () => {
    const onChange = vi.fn();
    render(<TokenAmountInput label="Amount" locale="de-DE" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Amount" });

    await userEvent.type(input, "1.2345678");

    expect(onChange).toHaveBeenLastCalledWith(BigInt("12345678"));
  });

  it("formats the controlled value for US and German locales", () => {
    const { rerender } = render(
      <TokenAmountInput label="Amount" locale="en-US" value={BigInt("1000000000000000")} />,
    );
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("100,000,000");

    rerender(<TokenAmountInput label="Amount" locale="de-DE" value={BigInt("1000000000000000")} />);
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("100.000.000");
  });

  it("shows validation errors for negative, over-precision, and oversized values", async () => {
    const { unmount } = render(<TokenAmountInput label="Amount" />);
    const input = screen.getByRole("textbox", { name: "Amount" });

    await userEvent.type(input, "-1");
    expect(screen.getByRole("alert")).toHaveTextContent(/negative/i);
    unmount();

    const { unmount: unmountPrecision } = render(<TokenAmountInput label="Precision" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Precision" }), "1.12345678");
    expect(screen.getByRole("alert")).toHaveTextContent(/7 decimal places/i);
    unmountPrecision();

    render(<TokenAmountInput label="Range" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Range" }), I128_MAX.toString());
    expect(screen.getByRole("alert")).toHaveTextContent(/i128/i);
  });

  it("shows a human-readable label for large amounts", () => {
    render(<TokenAmountInput label="Amount" value={BigInt("15000000000000000")} />);
    expect(screen.getByTestId("token-amount-abbreviation")).toHaveTextContent("1.5B");
  });
});
