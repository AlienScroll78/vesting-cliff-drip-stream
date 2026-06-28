export type StreamStatus = "active" | "pre-cliff" | "completed" | "cancelled";

export interface VestingStream {
  id: string;
  recipient: string;
  sponsor: string;
  token: string;
  rate: number;
  claimableAmount: number;
  status: StreamStatus;
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
