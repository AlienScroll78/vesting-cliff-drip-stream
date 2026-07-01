export type StreamStatus = "active" | "pre-cliff" | "completed" | "cancelled";

export interface WalletBalance {
  /** SAC contract address, or "native" for XLM */
  assetCode: string;
  /** Full contract / issuer address; "native" for XLM */
  contractAddress: string;
  /** Human-readable balance string as returned by Horizon */
  balance: string;
}

export interface VestingStream {
  id: string;
  recipient: string;
  sponsor: string;
  token: string;
  rate: number;
  claimableAmount: number;
  status: StreamStatus;
  // Optional schedule details (populated from contract reads)
  startLedger?: number;
  cliffLedger?: number;
  endLedger?: number;
  totalDeposit?: number;
  totalVested?: number;
}

export type TxType = "claim" | "create" | "cancel";

export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  token: string;
  hash: string;
  /** ISO-8601 timestamp from the backend */
  timestamp: string;
  counterparty: string;
}
