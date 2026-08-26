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

// ── Horizon event types (closes #272) ─────────────────────────────────────────

/** Event type identifiers as emitted by the Soroban contract. */
export type HorizonEventType = "StreamCreated" | "TokensClaimed" | "StreamCancelled";

/** A decoded contract event from Horizon. */
export interface HorizonEvent {
  /** Unique event identifier (ledger_sequence:tx_index:event_index) */
  id: string;
  type: HorizonEventType;
  /** Ledger sequence number */
  ledger: number;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Transaction hash (64-char hex) */
  txHash: string;
  /** Token amount involved (0 for events without an amount) */
  amount: number;
  /** Token symbol or contract address */
  token: string;
  /** Recipient address */
  recipient: string;
  /** Sponsor address (present for StreamCreated and StreamCancelled) */
  sponsor?: string;
}
