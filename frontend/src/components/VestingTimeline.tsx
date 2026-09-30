"use client";
import { useRef, useState, useCallback, useId } from "react";
import { motion } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VestingTimelineProps {
  startLedger: number;
  cliffLedger: number;
  endLedger: number;
  currentLedger: number;
  totalAmount: bigint;
  claimedAmount: bigint;
  claimableAmount: bigint;
  tokenSymbol: string;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SECONDS_PER_LEDGER = 5;

function ledgerToDate(ledger: number, startLedger: number): string {
  const secondsFromStart = (ledger - startLedger) * SECONDS_PER_LEDGER;
  const d = new Date(Date.now() + secondsFromStart * 1000);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtToken(amount: bigint, symbol: string): string {
  return `${Number(amount).toLocaleString()} ${symbol}`;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// Phase of the stream based on current ledger
type Phase = "pre-cliff" | "post-cliff" | "expired";

function getPhase(
  currentLedger: number,
  cliffLedger: number,
  endLedger: number
): Phase {
  if (currentLedger < cliffLedger) return "pre-cliff";
  if (currentLedger >= endLedger) return "expired";
  return "post-cliff";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Tooltip({ state }: { state: TooltipState }) {
  if (!state.visible) return null;
  return (
    <div
      role="tooltip"
      style={{
        position: "absolute",
        left: state.x,
        top: state.y,
        transform: "translate(-50%, calc(-100% - 8px))",
        background: "var(--color-bg-elevated, #334155)",
        border: "1px solid var(--color-border, #334155)",
        borderRadius: "6px",
        color: "var(--color-text-primary, #f8fafc)",
        fontSize: "12px",
        lineHeight: "1.5",
        maxWidth: "200px",
        padding: "6px 10px",
        pointerEvents: "none",
        whiteSpace: "pre-line",
        zIndex: 20,
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      {state.content}
    </div>
  );
}

function PhaseLabel({
  label,
  color,
  pct,
  minWidth = 60,
}: {
  label: string;
  color: string;
  pct: number;
  minWidth?: number;
}) {
  if (pct < 3) return null;
  return (
    <span
      style={{
        color,
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth,
        textAlign: "center",
      }}
    >
      {label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * VestingTimeline — SVG-free, CSS-based timeline visualising:
 *  [=== CLIFF ===|=== CLAIMED ===|=== CLAIMABLE ===|--- LOCKED ---]
 *
 * Features:
 * - Animated cursor at current ledger position
 * - Hover tooltips on each segment
 * - Phase labels inside segments
 * - Ledger markers below track
 * - PNG export via canvas
 * - Responsive: collapses to compact view on mobile
 */
export function VestingTimeline({
  startLedger,
  cliffLedger,
  endLedger,
  currentLedger,
  totalAmount,
  claimedAmount,
  claimableAmount,
  tokenSymbol,
}: VestingTimelineProps) {
  const descId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    content: "",
  });
  const [exporting, setExporting] = useState(false);

  const total = endLedger - startLedger;
  const safe = Math.max(total, 1);

  // ── Segment percentages ───────────────────────────────────────────────────
  const cliffDuration = cliffLedger - startLedger;
  const cliffPct = clamp((cliffDuration / safe) * 100, 0, 100);

  const phase = getPhase(currentLedger, cliffLedger, endLedger);
  const lockedTotal = totalAmount - claimedAmount - claimableAmount;
  const lockedSafe = lockedTotal < 0n ? 0n : lockedTotal;

  const claimedPct = clamp(
    (Number(claimedAmount) / Math.max(Number(totalAmount), 1)) * 100,
    0,
    100
  );
  const claimablePct = clamp(
    (Number(claimableAmount) / Math.max(Number(totalAmount), 1)) * 100,
    0,
    100
  );
  const lockedPct = clamp(
    100 - cliffPct - claimedPct - claimablePct,
    0,
    100
  );

  // Current cursor position
  const cursorPct = clamp(
    ((currentLedger - startLedger) / safe) * 100,
    0,
    100
  );

  // ── Tooltip helpers ───────────────────────────────────────────────────────
  const showTooltip = useCallback(
    (e: React.MouseEvent, content: string) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        content,
      });
    },
    []
  );
  const hideTooltip = useCallback(() => {
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, []);

  // ── PNG Export ────────────────────────────────────────────────────────────
  const exportPng = useCallback(async () => {
    setExporting(true);
    try {
      const W = 800;
      const H = 160;
      const BAR_Y = 56;
      const BAR_H = 36;

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;

      // Background
      ctx.fillStyle = "#0F172A";
      ctx.fillRect(0, 0, W, H);

      // Title
      ctx.fillStyle = "#F8FAFC";
      ctx.font = "bold 14px Inter, system-ui, sans-serif";
      ctx.fillText(`Vesting Timeline — ${tokenSymbol}`, 16, 32);

      // Helper to draw a segment
      const drawSeg = (
        startFrac: number,
        widthFrac: number,
        color: string,
        label: string
      ) => {
        const x = startFrac * W;
        const w = widthFrac * W;
        if (w < 1) return;
        ctx.fillStyle = color;
        ctx.fillRect(x, BAR_Y, w, BAR_H);
        if (w > 40) {
          ctx.fillStyle = "#fff";
          ctx.font = "bold 11px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(label, x + w / 2, BAR_Y + BAR_H / 2 + 4);
          ctx.textAlign = "left";
        }
      };

      let cursor = 0;
      // Cliff (locked pre-cliff)
      const cliffFrac = cliffPct / 100;
      drawSeg(cursor, cliffFrac, "#b45309", "CLIFF");
      cursor += cliffFrac;

      // Claimed
      const claimedFrac = claimedPct / 100;
      drawSeg(cursor, claimedFrac, "#15803d", "CLAIMED");
      cursor += claimedFrac;

      // Claimable
      const claimableFrac = claimablePct / 100;
      drawSeg(cursor, claimableFrac, "#ca8a04", "CLAIMABLE");
      cursor += claimableFrac;

      // Locked
      const lockedFrac = lockedPct / 100;
      drawSeg(cursor, lockedFrac, "#334155", "LOCKED");

      // Cursor line
      const cx = cursorPct / 100 * W;
      ctx.strokeStyle = "#7C3AED";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, BAR_Y - 6);
      ctx.lineTo(cx, BAR_Y + BAR_H + 6);
      ctx.stroke();

      // Labels
      ctx.fillStyle = "#94A3B8";
      ctx.font = "11px Inter, system-ui, sans-serif";
      const markers = [
        { label: `Start\n${startLedger}`, pct: 0 },
        { label: `Cliff\n${cliffLedger}`, pct: cliffPct },
        { label: `Now\n${currentLedger}`, pct: cursorPct },
        { label: `End\n${endLedger}`, pct: 100 },
      ];
      markers.forEach(({ label, pct }) => {
        const mx = (pct / 100) * W;
        const parts = label.split("\n");
        ctx.fillStyle = "#94A3B8";
        ctx.textAlign = "center";
        ctx.fillText(parts[0], mx, BAR_Y + BAR_H + 16);
        ctx.fillText(parts[1], mx, BAR_Y + BAR_H + 28);
      });
      ctx.textAlign = "left";

      // Download
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `vesting-timeline-${tokenSymbol}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
    } finally {
      setExporting(false);
    }
  }, [
    tokenSymbol,
    startLedger,
    cliffLedger,
    endLedger,
    currentLedger,
    cliffPct,
    claimedPct,
    claimablePct,
    lockedPct,
    cursorPct,
  ]);

  // ── Phase status text ─────────────────────────────────────────────────────
  const phaseLabel =
    phase === "pre-cliff"
      ? "Pre-cliff — tokens locked until cliff ledger"
      : phase === "expired"
      ? "Stream expired — all tokens released"
      : "Post-cliff — linear drip in progress";

  return (
    <article
      aria-label="Vesting timeline"
      style={{
        background: "var(--color-bg-surface, #1E293B)",
        borderRadius: "12px",
        padding: "20px 24px 16px",
        fontFamily: "var(--font-family-base, system-ui, sans-serif)",
        color: "var(--color-text-primary, #f8fafc)",
        maxWidth: "100%",
      }}
    >
      {/* Screen-reader summary */}
      <p id={descId} className="sr-only">
        Vesting timeline for {tokenSymbol}. Total: {fmtToken(totalAmount, tokenSymbol)}.
        Claimed: {fmtToken(claimedAmount, tokenSymbol)}.
        Claimable: {fmtToken(claimableAmount, tokenSymbol)}.
        Locked: {fmtToken(lockedSafe, tokenSymbol)}.
        Phase: {phaseLabel}.
      </p>

      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: "15px",
              fontWeight: 700,
              color: "var(--color-text-primary, #f8fafc)",
            }}
          >
            Vesting Timeline
          </h3>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: "12px",
              color: "var(--color-text-secondary, #94a3b8)",
            }}
          >
            {phaseLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={exportPng}
          disabled={exporting}
          aria-label="Export timeline as PNG"
          style={{
            background: "var(--color-bg-elevated, #334155)",
            border: "1px solid var(--color-border, #334155)",
            borderRadius: "6px",
            color: "var(--color-text-secondary, #94a3b8)",
            cursor: exporting ? "not-allowed" : "pointer",
            fontSize: "12px",
            padding: "5px 10px",
            opacity: exporting ? 0.6 : 1,
          }}
        >
          {exporting ? "Exporting…" : "⬇ Export PNG"}
        </button>
      </div>

      {/* Track */}
      <div style={{ position: "relative" }} ref={trackRef}>
        <Tooltip state={tooltip} />

        {/* Progress bar track */}
        <div
          role="img"
          aria-labelledby={descId}
          style={{
            display: "flex",
            height: "40px",
            borderRadius: "8px",
            overflow: "hidden",
            background: "var(--color-bg-elevated, #334155)",
            position: "relative",
          }}
        >
          {/* Cliff segment (amber) */}
          {cliffPct > 0 && (
            <div
              data-testid="segment-cliff"
              onMouseMove={(e) =>
                showTooltip(
                  e,
                  `Cliff period\n${cliffDuration} ledgers locked\n≈ ${ledgerToDate(cliffLedger, startLedger)}`
                )
              }
              onMouseLeave={hideTooltip}
              style={{
                width: `${cliffPct}%`,
                background: "#b45309",
                backgroundImage:
                  "repeating-linear-gradient(-45deg,transparent,transparent 5px,rgba(255,255,255,.08) 5px,rgba(255,255,255,.08) 10px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "default",
                transition: "opacity 0.15s",
                minWidth: cliffPct > 0 ? "4px" : 0,
              }}
            >
              <PhaseLabel label="CLIFF" color="#fff" pct={cliffPct} />
            </div>
          )}

          {/* Claimed segment (green) */}
          {claimedPct > 0 && (
            <div
              data-testid="segment-claimed"
              onMouseMove={(e) =>
                showTooltip(
                  e,
                  `Claimed\n${fmtToken(claimedAmount, tokenSymbol)}\nalready withdrawn`
                )
              }
              onMouseLeave={hideTooltip}
              style={{
                width: `${claimedPct}%`,
                background: "#15803d",
                backgroundImage:
                  "repeating-linear-gradient(45deg,transparent,transparent 5px,rgba(255,255,255,.08) 5px,rgba(255,255,255,.08) 10px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "default",
                transition: "width 0.4s ease",
                minWidth: claimedPct > 0 ? "4px" : 0,
              }}
            >
              <PhaseLabel label="CLAIMED" color="#fff" pct={claimedPct} />
            </div>
          )}

          {/* Claimable segment (yellow) */}
          {claimablePct > 0 && (
            <motion.div
              data-testid="segment-claimable"
              initial={{ opacity: 0.6 }}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              onMouseMove={(e) =>
                showTooltip(
                  e,
                  `Claimable now\n${fmtToken(claimableAmount, tokenSymbol)}\navailable to withdraw`
                )
              }
              onMouseLeave={hideTooltip}
              style={{
                width: `${claimablePct}%`,
                background: "#ca8a04",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "default",
                minWidth: claimablePct > 0 ? "4px" : 0,
              }}
            >
              <PhaseLabel label="CLAIMABLE" color="#fff" pct={claimablePct} />
            </motion.div>
          )}

          {/* Locked segment (grey) */}
          {lockedPct > 0 && (
            <div
              data-testid="segment-locked"
              onMouseMove={(e) =>
                showTooltip(
                  e,
                  `Locked (future)\n${fmtToken(lockedSafe, tokenSymbol)}\nreleases linearly until end`
                )
              }
              onMouseLeave={hideTooltip}
              style={{
                flex: 1,
                background: "var(--color-bg-elevated, #334155)",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "default",
              }}
            >
              <PhaseLabel
                label="LOCKED"
                color="var(--color-text-disabled, #475569)"
                pct={lockedPct}
              />
            </div>
          )}
        </div>

        {/* Animated cursor */}
        <motion.div
          data-testid="cursor"
          initial={{ left: `${cursorPct}%` }}
          animate={{ left: `${cursorPct}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          style={{
            position: "absolute",
            top: -6,
            bottom: -6,
            width: "2px",
            background: "var(--color-brand-primary, #7C3AED)",
            borderRadius: "1px",
            pointerEvents: "none",
            boxShadow: "0 0 6px rgba(124,58,237,0.6)",
          }}
          aria-hidden="true"
        />

        {/* Cursor cap diamond */}
        <motion.div
          initial={{ left: `${cursorPct}%` }}
          animate={{ left: `${cursorPct}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          style={{
            position: "absolute",
            top: -10,
            width: "10px",
            height: "10px",
            background: "var(--color-brand-primary, #7C3AED)",
            borderRadius: "2px",
            transform: "translateX(-4px) rotate(45deg)",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        />
      </div>

      {/* Ledger markers */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "8px",
          fontSize: "11px",
          color: "var(--color-text-secondary, #94a3b8)",
          position: "relative",
        }}
      >
        <LedgerMarker
          label="Start"
          ledger={startLedger}
          date={ledgerToDate(startLedger, startLedger)}
          align="left"
        />
        <LedgerMarker
          label="Cliff"
          ledger={cliffLedger}
          date={ledgerToDate(cliffLedger, startLedger)}
          align="center"
        />
        <LedgerMarker
          label="Now"
          ledger={currentLedger}
          date={ledgerToDate(currentLedger, startLedger)}
          align="center"
          highlight
        />
        <LedgerMarker
          label="End"
          ledger={endLedger}
          date={ledgerToDate(endLedger, startLedger)}
          align="right"
        />
      </div>

      {/* Amount legend */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          marginTop: "16px",
          paddingTop: "12px",
          borderTop: "1px solid var(--color-border, #334155)",
          fontSize: "12px",
        }}
      >
        <LegendItem color="#b45309" label="Cliff" amount={fmtToken(0n, tokenSymbol)} note="locked until cliff" />
        <LegendItem color="#15803d" label="Claimed" amount={fmtToken(claimedAmount, tokenSymbol)} />
        <LegendItem color="#ca8a04" label="Claimable" amount={fmtToken(claimableAmount, tokenSymbol)} />
        <LegendItem color="#334155" label="Locked" amount={fmtToken(lockedSafe, tokenSymbol)} bordered />
        <div style={{ marginLeft: "auto", color: "var(--color-text-secondary, #94a3b8)" }}>
          Total: <strong style={{ color: "var(--color-text-primary, #f8fafc)" }}>{fmtToken(totalAmount, tokenSymbol)}</strong>
        </div>
      </div>
    </article>
  );
}

// ─── Legend item ──────────────────────────────────────────────────────────────

function LegendItem({
  color,
  label,
  amount,
  note,
  bordered = false,
}: {
  color: string;
  label: string;
  amount: string;
  note?: string;
  bordered?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <span
        aria-hidden="true"
        style={{
          width: "12px",
          height: "12px",
          borderRadius: "3px",
          background: color,
          border: bordered ? "1px solid #475569" : undefined,
          flexShrink: 0,
        }}
      />
      <span style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
        {label}:
      </span>{" "}
      <strong style={{ color: "var(--color-text-primary, #f8fafc)" }}>
        {amount}
      </strong>
      {note && (
        <span style={{ color: "var(--color-text-disabled, #475569)" }}>
          {" "}
          ({note})
        </span>
      )}
    </span>
  );
}

// ─── Ledger marker ────────────────────────────────────────────────────────────

function LedgerMarker({
  label,
  ledger,
  date,
  align,
  highlight = false,
}: {
  label: string;
  ledger: number;
  date: string;
  align: "left" | "center" | "right";
  highlight?: boolean;
}) {
  return (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems:
          align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
        gap: "1px",
      }}
    >
      <span
        style={{
          fontWeight: 600,
          color: highlight
            ? "var(--color-brand-primary, #7C3AED)"
            : "var(--color-text-secondary, #94a3b8)",
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-family-mono, monospace)" }}>
        {ledger}
      </span>
      <span
        style={{
          fontSize: "10px",
          color: "var(--color-text-disabled, #475569)",
        }}
      >
        {date}
      </span>
    </span>
  );
}
