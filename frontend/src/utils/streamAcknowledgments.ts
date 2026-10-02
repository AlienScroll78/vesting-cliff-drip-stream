import { VestingStream } from "@/types";

const API_BASE_URL =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3001/api";

export type AcknowledgmentAction = "acknowledge" | "skip";

export interface StreamAcknowledgment {
  recipient: string;
  sponsor: string;
  token: string;
  acknowledged_at: string | null;
  skipped_at: string | null;
  signed_message: string | null;
  pending: boolean;
}

export interface SignMessageResult {
  signedMessage: string;
  signerAddress: string;
}

export type SignMessageFn = (
  message: string,
) => Promise<SignMessageResult>;

export function acknowledgmentsEndpoint(recipient: string): string {
  return `${API_BASE_URL}/streams/${encodeURIComponent(recipient)}/acknowledgments`;
}

export function buildAcknowledgmentMessage(
  stream: VestingStream,
  network: string,
): string {
  const lines = [
    "Vesting stream acknowledgment",
    `version: 1`,
    `network: ${network}`,
    `sponsor: ${stream.sponsor}`,
    `recipient: ${stream.recipient}`,
    `token: ${stream.token}`,
    `rate: ${stream.rate} tokens per ledger`,
  ];
  if (stream.totalDeposit !== undefined) {
    lines.push(`total deposit: ${stream.totalDeposit} ${stream.token}`);
  }
  if (stream.startLedger !== undefined) {
    lines.push(`start ledger: ${stream.startLedger}`);
  }
  if (stream.cliffLedger !== undefined) {
    lines.push(`cliff ledger: ${stream.cliffLedger}`);
  }
  if (stream.endLedger !== undefined) {
    lines.push(`end ledger: ${stream.endLedger}`);
  }
  return lines.join("\n");
}

export async function fetchAcknowledgments(
  recipient: string,
): Promise<StreamAcknowledgment[]> {
  const response = await fetch(acknowledgmentsEndpoint(recipient));
  if (!response.ok) {
    throw new Error(`Failed to load acknowledgments (${response.status})`);
  }
  const body = (await response.json()) as { items?: StreamAcknowledgment[] };
  return body.items ?? [];
}

export async function submitAcknowledgment(
  recipient: string,
  payload: {
    sponsor: string;
    token: string;
    action: AcknowledgmentAction;
    signedMessage?: string;
  },
): Promise<StreamAcknowledgment> {
  const response = await fetch(acknowledgmentsEndpoint(recipient), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to save acknowledgment (${response.status})`);
  }
  return (await response.json()) as StreamAcknowledgment;
}
