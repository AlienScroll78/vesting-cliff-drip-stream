"use client";

import type { ReactNode } from "react";

// ~5 seconds per ledger on Stellar (mirrors the constant in StreamCreateForm)
const SECONDS_PER_LEDGER = 5;
const LEDGERS_PER_DAY = Math.round((24 * 60 * 60) / SECONDS_PER_LEDGER);

interface VestingSchedulePrintProps {
  /** Stellar address of the stream funder */
  sponsor: string;
  /** Stellar address of the stream beneficiary */
  recipient: string;
  /** SAC token contract address */
  token: string;
  /** Tokens released per ledger */
  rate: number;
  /** Number of ledgers until the cliff */
  cliffLedgers: number;
  /** Total stream length in ledgers */
  totalLedgers: number;
  /** Cliff duration expressed in days (for human-readable display) */
  cliffDays: number;
  /** Total duration expressed in days (for human-readable display) */
  totalDays: number;
  /**
   * ISO timestamp string to display as "generated at" time.
   * Defaults to the time the component first renders.
   */
  generatedAt?: string;
}

function formatAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-8)}`;
}

/**
 * VestingSchedulePrint — a print-only view of a vesting schedule.
 *
 * Rendered in the DOM at all times but hidden via CSS (`.print-only`
 * has `display: none` in normal view and `display: block !important`
 * inside `@media print`).  The element carries id="schedule-preview"
 * so that print.css can target it directly.
 */
export function VestingSchedulePrint({
  sponsor,
  recipient,
  token,
  rate,
  cliffLedgers,
  totalLedgers,
  cliffDays,
  totalDays,
  generatedAt,
}: VestingSchedulePrintProps) {
  const timestamp = generatedAt ?? new Date().toISOString();
  const totalDeposit = rate * totalLedgers;

  // Approximate duration labels
  const cliffLabel =
    cliffDays >= 1
      ? `${cliffDays.toLocaleString()} day${cliffDays !== 1 ? "s" : ""}`
      : `${(cliffDays * 24).toFixed(1)} hours`;

  const totalLabel =
    totalDays >= 1
      ? `${totalDays.toLocaleString()} day${totalDays !== 1 ? "s" : ""}`
      : `${(totalDays * 24).toFixed(1)} hours`;

  // Drip-only portion after cliff
  const postCliffLedgers = totalLedgers - cliffLedgers;
  const postCliffDays = postCliffLedgers / LEDGERS_PER_DAY;
  const postCliffLabel =
    postCliffDays >= 1
      ? `${postCliffDays.toLocaleString(undefined, { maximumFractionDigits: 1 })} days`
      : `${(postCliffDays * 24).toFixed(1)} hours`;

  const rows: [string, ReactNode][] = [
    [
      "Sponsor",
      <span className="addr" title={sponsor}>
        {formatAddress(sponsor)}
      </span>,
    ],
    [
      "Recipient",
      <span className="addr" title={recipient}>
        {formatAddress(recipient)}
      </span>,
    ],
    [
      "Token contract",
      <span className="addr" title={token}>
        {formatAddress(token)}
      </span>,
    ],
    ["Rate", `${rate.toLocaleString()} tokens / ledger`],
    [
      "Cliff duration",
      `${cliffLabel} (${cliffLedgers.toLocaleString()} ledgers)`,
    ],
    [
      "Total duration",
      `${totalLabel} (${totalLedgers.toLocaleString()} ledgers)`,
    ],
    [
      "Linear drip window",
      `${postCliffLabel} (${postCliffLedgers.toLocaleString()} ledgers after cliff)`,
    ],
    [
      "Total deposit",
      <strong>{totalDeposit.toLocaleString()} tokens</strong>,
    ],
  ];

  return (
    <section
      id="schedule-preview"
      className="print-only"
      aria-label="Vesting schedule print preview"
    >
      {/* ── Header ── */}
      <header className="print-header">
        <div className="print-logo">⬡ Vesting Cliff Drip Stream</div>
        <div className="print-meta">
          <span>Generated: {timestamp}</span>
        </div>
      </header>

      <h2>Vesting Schedule</h2>

      {/* ── Schedule table ── */}
      <table aria-label="Vesting schedule details">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([field, value]) => (
            <tr key={field}>
              <td>{field}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Token flow diagram (text art, renders cleanly on paper) ── */}
      <pre className="print-flow" aria-label="Token flow timeline">
        {[
          "Token Flow",
          "─────────────────────────────────────────────────────────────",
          `Ledger:  start_ledger          cliff (${cliffLedgers.toLocaleString()})         end (${totalLedgers.toLocaleString()})`,
          "              │                    │                          │",
          "Tokens:        │  [locked / cliff]  │ ← instant catch-up →   │ ← linear drip ──┤",
        ].join("\n")}
      </pre>
    </section>
  );
}

export default VestingSchedulePrint;
