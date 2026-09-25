export const LEDGERS_PER_SECOND = 5;
export const LEDGERS_PER_DAY = Math.round((24 * 60 * 60) / LEDGERS_PER_SECOND);
export const RATE_DECIMALS = 10_000_000;
export const I128_MAX = BigInt("170141183460469231731687303715884105727");

export interface RateSegment {
  endLedger: number;
  rate: number;
}

export interface CreateStreamRequest {
  sponsor: string;
  recipient: string;
  token: string;
  amount: number;
  rate: number;
  cliffLedgers: number;
  totalLedgers: number;
  metadata?: string;
  variableRateSegments?: RateSegment[];
  allowlistOverride?: boolean;
  feeOverrideBps?: number;
}

export function daysToLedgers(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.round(days * LEDGERS_PER_DAY);
}

export function deriveRate(amount: number, totalLedgers: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(totalLedgers) || totalLedgers <= 0) {
    return null;
  }
  const scaledAmount = amount * RATE_DECIMALS;
  if (!Number.isFinite(scaledAmount)) return null;
  const rate = Math.ceil(scaledAmount / totalLedgers);
  return Number.isSafeInteger(rate) && rate > 0 ? rate : null;
}

export function depositFromRate(rate: number, totalLedgers: number): number {
  if (!Number.isFinite(rate) || !Number.isFinite(totalLedgers) || rate <= 0 || totalLedgers <= 0) {
    return 0;
  }
  return (rate * totalLedgers) / RATE_DECIMALS;
}

export function isRateDepositOverflow(rate: number, totalLedgers: number): boolean {
  if (!Number.isFinite(rate) || !Number.isFinite(totalLedgers) || rate <= 0 || totalLedgers <= 0) {
    return false;
  }
  try {
    return BigInt(Math.floor(rate)) * BigInt(Math.floor(totalLedgers)) > I128_MAX;
  } catch {
    return true;
  }
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export interface SegmentParseResult {
  segments: RateSegment[];
  error?: string;
}

export function parseRateSegments(value: string): SegmentParseResult {
  const rows = value.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (rows.length > 10) {
    return { segments: [], error: "Use no more than 10 rate segments." };
  }

  const segments: RateSegment[] = [];
  let previousEnd = 0;
  for (const row of rows) {
    const parts = row.split(/[,\t]/).map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { segments: [], error: "Each segment must use the format end ledger, rate." };
    }
    const endLedger = Number(parts[0]);
    const rate = Number(parts[1]);
    if (!Number.isSafeInteger(endLedger) || endLedger <= 0 || !Number.isSafeInteger(rate) || rate <= 0) {
      return { segments: [], error: "Segment ledgers and rates must be positive integers." };
    }
    if (endLedger <= previousEnd) {
      return { segments: [], error: "Segment end ledgers must increase in order." };
    }
    segments.push({ endLedger, rate });
    previousEnd = endLedger;
  }

  return { segments };
}

export function formatTokenAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 7 }).format(value);
}
