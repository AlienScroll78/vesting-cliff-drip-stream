export const TOKEN_DECIMAL_PLACES = 7;
export const TOKEN_SCALE = BigInt("10000000");
export const I128_MAX = BigInt("170141183460469231731687303715884105727");

export type TokenAmountError = "negative" | "precision" | "range" | "format";

export interface TokenAmountParseResult {
  value: bigint | null;
  error: TokenAmountError | null;
  message: string | null;
}

interface LocaleSeparators {
  decimal: string;
  group: string;
}

const ERROR_MESSAGES: Record<TokenAmountError, string> = {
  negative: "Amount cannot be negative.",
  precision: "Use no more than 7 decimal places.",
  range: "Amount exceeds the maximum supported i128 value.",
  format: "Enter a valid token amount.",
};

function getLocaleSeparators(locale?: string): LocaleSeparators {
  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat(locale ?? undefined, {
      maximumFractionDigits: 1,
      useGrouping: true,
    }).formatToParts(1234567.1);
  } catch {
    parts = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
      useGrouping: true,
    }).formatToParts(1234567.1);
  }

  return {
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
    group: parts.find((part) => part.type === "group")?.value ?? ",",
  };
}

function count(value: string, separator: string): number {
  return value.split(separator).length - 1;
}

function isValidGrouping(value: string, separator: string): boolean {
  if (count(value, separator) === 0) return true;
  const groups = value.split(separator);
  if (!/^\d{1,3}$/.test(groups[0] ?? "")) return false;
  return groups.slice(1).every((group) => /^\d{3}$/.test(group));
}

function stripGrouping(value: string, separator: string): string {
  return value.split(separator).join("");
}

function makeResult(
  value: bigint | null,
  error: TokenAmountError | null = null,
): TokenAmountParseResult {
  return {
    value,
    error,
    message: error ? ERROR_MESSAGES[error] : null,
  };
}

function parseParts(input: string, locale?: string): TokenAmountParseResult {
  const trimmed = input.trim();
  if (!trimmed) return makeResult(null);
  if (trimmed.includes("-")) return makeResult(null, "negative");

  const compact = trimmed.replace(/[\s\u00a0]/g, "");
  if (!/^[0-9.,]+$/.test(compact)) return makeResult(null, "format");

  const { decimal, group } = getLocaleSeparators(locale);
  const alternate = decimal === "." ? "," : ".";
  let integer = compact;
  let fraction = "";

  if (count(compact, decimal) === 1) {
    const parts = compact.split(decimal);
    integer = parts[0] ?? "";
    fraction = parts[1] ?? "";
    if (count(integer, group) > 0 && !isValidGrouping(integer, group)) {
      return makeResult(null, "format");
    }
    integer = stripGrouping(integer, group);
  } else if (count(compact, decimal) > 1) {
    return makeResult(null, "format");
  } else {
    const groupCount = count(integer, group);
    const alternateCount = alternate === group ? 0 : count(integer, alternate);

    if (groupCount > 0) {
      if (isValidGrouping(integer, group)) {
        integer = stripGrouping(integer, group);
      } else if (groupCount === 1 && alternateCount === 0) {
        const parts = integer.split(group);
        integer = parts[0] ?? "";
        fraction = parts[1] ?? "";
      } else {
        return makeResult(null, "format");
      }
    }

    if (count(fraction, alternate) > 0) {
      return makeResult(null, "format");
    }

    if (count(integer, alternate) > 0 && alternate !== group) {
      const parts = integer.split(alternate);
      if (parts.length !== 2) return makeResult(null, "format");
      integer = parts[0] ?? "";
      fraction = parts[1] ?? "";
    }

    if (count(integer, group) > 0) {
      if (!isValidGrouping(integer, group)) return makeResult(null, "format");
      integer = stripGrouping(integer, group);
    }
  }

  if (!/^\d*$/.test(integer) || !/^\d*$/.test(fraction)) {
    return makeResult(null, "format");
  }
  if (!integer && !fraction) return makeResult(null, "format");
  if (fraction.length > TOKEN_DECIMAL_PLACES) {
    return makeResult(null, "precision");
  }

  const normalizedInteger = integer || "0";
  const normalizedFraction = fraction.padEnd(TOKEN_DECIMAL_PLACES, "0");
  const value = BigInt(normalizedInteger + normalizedFraction);
  if (value > I128_MAX) return makeResult(null, "range");

  return makeResult(value);
}

export function parseTokenAmountResult(input: string, locale?: string): TokenAmountParseResult {
  return parseParts(input, locale);
}

export function parseTokenAmount(input: string, locale?: string): bigint | null {
  return parseParts(input, locale).value;
}

export function formatTokenAmount(value: bigint, locale?: string): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = absolute / TOKEN_SCALE;
  const fraction = (absolute % TOKEN_SCALE)
    .toString()
    .padStart(TOKEN_DECIMAL_PLACES, "0")
    .replace(/0+$/, "");
  const { decimal } = getLocaleSeparators(locale);
  const formattedWhole = new Intl.NumberFormat(locale ?? undefined, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(whole);
  const sign = negative ? "-" : "";

  return `${sign}${formattedWhole}${fraction ? `${decimal}${fraction}` : ""}`;
}

export function abbreviateTokenAmount(value: bigint, locale?: string): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const thresholds = [
    { tokens: BigInt("1000000000"), suffix: "B" },
    { tokens: BigInt("1000000"), suffix: "M" },
    { tokens: BigInt("1000"), suffix: "K" },
  ];

  for (const { tokens, suffix } of thresholds) {
    const divisor = tokens * TOKEN_SCALE;
    if (absolute < divisor) continue;

    const oneTenth = divisor / BigInt(10);
    const roundedTenths = (absolute + oneTenth / BigInt(2)) / oneTenth;
    const whole = roundedTenths / BigInt(10);
    const remainder = roundedTenths % BigInt(10);
    const formattedWhole = new Intl.NumberFormat(locale ?? undefined, {
      maximumFractionDigits: 0,
      useGrouping: true,
    }).format(whole);
    const { decimal } = getLocaleSeparators(locale);
    const fraction = remainder === BigInt(0) ? "" : `${decimal}${remainder.toString()}`;
    const sign = negative ? "-" : "";

    return `${sign}${formattedWhole}${fraction}${suffix}`;
  }

  return formatTokenAmount(value, locale);
}
