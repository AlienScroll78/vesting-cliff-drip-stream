"use client";
import { useId } from "react";
import { Tooltip } from "@/Tooltip";

export interface SegmentedProgressBarProps {
  /** Total tokens in the stream */
  total: number;
  /** Tokens still locked (before cliff) */
  locked: number;
  /** Tokens unlocked at the cliff catch-up */
  cliffCatchUp: number;
  /** Tokens released via linear drip so far */
  dripped: number;
  tokenSymbol?: string;
}

function fmt(n: number, sym: string) {
  return `${n.toLocaleString()} ${sym}`;
}

/**
 * Segmented progress bar with three visually distinct regions:
 *  - locked (grey)   — tokens not yet reachable (before cliff)
 *  - cliff (gold)    — instant catch-up amount unlocked at cliff
 *  - drip (green)    — linearly dripped tokens released after cliff
 *
 * Accessible: uses role="img" + aria-label summary, pattern fills for
 * non-colour differentiation, and keyboard-accessible tooltips.
 */
export function SegmentedProgressBar({
  total,
  locked,
  cliffCatchUp,
  dripped,
  tokenSymbol = "tokens",
}: SegmentedProgressBarProps) {
  const id = useId();
  const safe = Math.max(total, 1); // avoid /0

  const lockedPct    = (locked    / safe) * 100;
  const cliffPct     = (cliffCatchUp / safe) * 100;
  const drippedPct   = (dripped   / safe) * 100;
  const released     = cliffCatchUp + dripped;

  return (
    <div style={{ width: "100%" }}>
      {/* Screen-reader summary */}
      <p id={id} className="sr-only">
        Vesting progress: {fmt(released, tokenSymbol)} released of {fmt(total, tokenSymbol)}.
        Locked: {fmt(locked, tokenSymbol)}.
        Cliff catch-up: {fmt(cliffCatchUp, tokenSymbol)}.
        Dripped: {fmt(dripped, tokenSymbol)}.
      </p>

      {/* Bar track */}
      <div
        role="img"
        aria-labelledby={id}
        style={{
          display: "flex",
          height: "1.25rem",
          borderRadius: "9999px",
          overflow: "hidden",
          background: "var(--color-border, #e5e7eb)",
        }}
      >
        {drippedPct > 0 && (
          <div
            data-testid="seg-drip"
            style={{
              width: `${drippedPct}%`,
              background: "var(--color-completed, #15803d)",
              backgroundImage:
                "repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(255,255,255,.15) 4px,rgba(255,255,255,.15) 8px)",
              minWidth: drippedPct > 0 ? "4px" : 0,
              transition: "width 0.4s ease",
            }}
          />
        )}
        {cliffPct > 0 && (
          <div
            data-testid="seg-cliff"
            style={{
              width: `${cliffPct}%`,
              background: "var(--color-pre-cliff, #b45309)",
              backgroundImage:
                "repeating-linear-gradient(-45deg,transparent,transparent 4px,rgba(255,255,255,.15) 4px,rgba(255,255,255,.15) 8px)",
              minWidth: cliffPct > 0 ? "4px" : 0,
              transition: "width 0.4s ease",
            }}
          />
        )}
        {lockedPct > 0 && (
          <div
            data-testid="seg-locked"
            style={{
              flex: 1,
              background: "var(--color-border, #e5e7eb)",
            }}
          />
        )}
      </div>

      {/* Legend row with tooltips */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginTop: "0.5rem",
          fontSize: "0.8rem",
          flexWrap: "wrap",
        }}
      >
        <LegendItem
          color="var(--color-completed, #15803d)"
          label="Dripped"
          tooltip={`${fmt(dripped, tokenSymbol)} released via linear drip`}
        />
        <LegendItem
          color="var(--color-pre-cliff, #b45309)"
          label="Cliff catch-up"
          tooltip={`${fmt(cliffCatchUp, tokenSymbol)} unlocked instantly at the cliff`}
        />
        <LegendItem
          color="var(--color-border, #d1d5db)"
          label="Locked"
          tooltip={`${fmt(locked, tokenSymbol)} locked — cliff not yet reached`}
          dark
        />
      </div>
    </div>
  );
}

function LegendItem({
  color,
  label,
  tooltip,
  dark = false,
}: {
  color: string;
  label: string;
  tooltip: string;
  dark?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: "0.75rem",
          height: "0.75rem",
          borderRadius: "2px",
          background: color,
          border: dark ? "1px solid #9ca3af" : undefined,
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--color-text, #111827)" }}>{label}</span>
      <Tooltip content={tooltip} />
    </span>
  );
}
