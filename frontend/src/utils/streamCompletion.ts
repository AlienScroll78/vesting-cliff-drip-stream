export type CompletionStatus = "completed" | "expired" | "drained" | string;

export interface StreamCompletionEvidence {
  status?: CompletionStatus;
  currentLedger?: number | null;
  endLedger?: number | null;
  claimableAmount?: number | string | null;
  totalReceived?: number | string | null;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isExpiredAndFullyClaimed({
  status,
  currentLedger,
  endLedger,
  claimableAmount,
  totalReceived,
}: StreamCompletionEvidence): boolean {
  const terminalStatus = status === "completed" || status === "expired" || status === "drained";
  const current = toNumber(currentLedger);
  const end = toNumber(endLedger);
  const expiredByLedger = current !== null && end !== null && current >= end;

  if (!terminalStatus && !expiredByLedger) return false;

  const claimable = toNumber(claimableAmount);
  if (claimable === null || claimable !== 0) return false;

  const received = toNumber(totalReceived);
  return received !== null && received > 0;
}

export const isFullyClaimedExpired = isExpiredAndFullyClaimed;
