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
