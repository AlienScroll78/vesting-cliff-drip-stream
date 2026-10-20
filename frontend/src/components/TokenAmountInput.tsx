"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  abbreviateTokenAmount,
  formatTokenAmount,
  parseTokenAmountResult,
} from "@/utils/tokenAmount";

export {
  abbreviateTokenAmount,
  formatTokenAmount,
  I128_MAX,
  parseTokenAmount,
  parseTokenAmountResult,
  TOKEN_DECIMAL_PLACES,
  TOKEN_SCALE,
} from "@/utils/tokenAmount";

export interface TokenAmountInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "onChange" | "onBlur" | "type" | "id"
  > {
  id?: string;
  label?: ReactNode;
  value?: bigint | null;
  defaultValue?: bigint | null;
  onChange?: (value: bigint) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  locale?: string;
  tokenSymbol?: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  className?: string;
  style?: CSSProperties;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "onChange" | "onBlur" | "type" | "id"
  >;
}

export function TokenAmountInput({
  id,
  label = "Token amount",
  value,
  defaultValue,
  onChange,
  onBlur,
  locale,
  tokenSymbol,
  placeholder = "0",
  error,
  disabled = false,
  required = false,
  name,
  className,
  style,
  inputProps,
  ...nativeInputProps
}: TokenAmountInputProps) {
  const generatedId = useId();
  const inputId = id ?? `token-amount-${generatedId}`;
  const errorId = `${inputId}-error`;
  const abbreviationId = `${inputId}-abbreviation`;
  const [internalValue, setInternalValue] = useState<bigint | null>(defaultValue ?? null);
  const currentValue = value !== undefined ? value : internalValue;
  const [inputValue, setInputValue] = useState(() =>
    currentValue === null ? "" : formatTokenAmount(currentValue, locale),
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setInputValue(currentValue === null ? "" : formatTokenAmount(currentValue, locale));
    }
  }, [currentValue, locale]);

  const fullValue = currentValue === null ? null : formatTokenAmount(currentValue, locale);
  const abbreviatedValue = currentValue === null ? null : abbreviateTokenAmount(currentValue, locale);
  const showAbbreviation = abbreviatedValue !== null && abbreviatedValue !== fullValue;
  const displayedError = error ?? validationError;
  const mergedInputProps = { ...nativeInputProps, ...inputProps };
  const describedBy = [
    mergedInputProps["aria-describedby"],
    displayedError ? errorId : null,
    showAbbreviation ? abbreviationId : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  const {
    className: inputClassName,
    style: inputStyle,
    onFocus: inputOnFocus,
    ...restInputProps
  } = mergedInputProps;
  const inputTestId = (mergedInputProps as { "data-testid"?: string })["data-testid"];

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    focused.current = true;
    inputOnFocus?.(event);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const nextInput = event.target.value;
    const result = parseTokenAmountResult(nextInput, locale);
    setInputValue(nextInput);

    if (result.error) {
      setValidationError(result.message);
      return;
    }

    setValidationError(null);
    if (result.value === null) {
      if (value === undefined) setInternalValue(null);
      return;
    }

    if (value === undefined) setInternalValue(result.value);
    onChange?.(result.value);
  }

  function handleInputBlur(event: FocusEvent<HTMLInputElement>) {
    focused.current = false;
    const result = parseTokenAmountResult(inputValue, locale);
    if (result.error) {
      setValidationError(result.message);
    } else if (result.value === null) {
      setInputValue("");
    } else {
      setInputValue(formatTokenAmount(result.value, locale));
    }
    onBlur?.(event);
  }

  return (
    <div className={className} style={style}>
      <label htmlFor={inputId} style={styles.label}>
        {label}
      </label>
      <div style={styles.control}>
        <input
          {...restInputProps}
          id={inputId}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          onFocus={handleFocus}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          aria-invalid={!!displayedError}
          aria-describedby={describedBy}
          className={["token-amount-input", inputClassName].filter(Boolean).join(" ")}
          data-testid={inputTestId ?? "token-amount-input"}
          style={{ ...styles.input, ...inputStyle }}
        />
        {tokenSymbol && <span style={styles.symbol}>{tokenSymbol}</span>}
      </div>
      {showAbbreviation && (
        <span id={abbreviationId} style={styles.abbreviation} data-testid="token-amount-abbreviation">
          {abbreviatedValue}
        </span>
      )}
      {displayedError && (
        <span id={errorId} role="alert" style={styles.error} data-testid="token-amount-error">
          {displayedError}
        </span>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  label: { display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.25rem" },
  control: { display: "flex", alignItems: "center", gap: "0.5rem" },
  input: {
    boxSizing: "border-box",
    width: "100%",
    padding: "0.5rem 0.75rem",
    border: "1px solid var(--color-border, #d8e1e7)",
    borderRadius: "var(--radius, 6px)",
    fontSize: "0.95rem",
    outline: "none",
  },
  symbol: { flexShrink: 0, fontSize: "0.875rem", color: "#687983" },
  abbreviation: { display: "block", marginTop: "0.25rem", fontSize: "0.8rem", color: "#687983" },
  error: { display: "block", marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--color-cancelled, #b53030)" },
};
