import { type FeeEstimate, estimateFee } from "@/utils/feeEstimate";

export type TransactionKind = "claim" | "create" | "cancel";

export const TRANSACTION_LABELS: Record<TransactionKind, string> = {
  claim: "Claim Vested Tokens",
  create: "Create Vesting Stream",
  cancel: "Cancel Vesting Stream",
};

export const FEE_WARNING_THRESHOLD_XLM = 1;

export const ESTIMATED_CONFIRMATION_SECONDS = 5;

export type FeeEstimator = () => Promise<FeeEstimate | null>;

export type XdrProvider = () => Promise<string | null>;

export const defaultFeeEstimator: FeeEstimator = () => estimateFee();

export async function getRawTransactionXdr(): Promise<string | null> {
  return null;
}

export function parseFeeXlm(fee: FeeEstimate): number {
  const parsed = Number.parseFloat(fee.xlm);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isFeeAboveWarningThreshold(fee: FeeEstimate): boolean {
  return parseFeeXlm(fee) > FEE_WARNING_THRESHOLD_XLM;
}
