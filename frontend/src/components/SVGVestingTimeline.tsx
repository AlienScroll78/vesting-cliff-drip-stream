/**
 * SVGVestingTimeline — pure SVG timeline showing the three phases of a vesting stream.
 *
 * Phases:
 *  1. Locked period (start → cliff)
 *  2. Cliff unlock (instantaneous marker)
 *  3. Linear drip (cliff → end)
 *
 * Features:
 *  - SVG-based (not recharts), matching the ASCII diagram in the README
 *  - Current ledger position marker with smooth CSS animation
 *  - Tooltip on hover showing ledger numbers and estimated dates
 *  - Claimable region highlighted in green
 *  - Accessible aria labels and title elements
 *  - Responsive: renders correctly down to 320px width
 *
 * @closes #271
 */
"use client";
import { useRef, useState, useId } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SVGVestingTimelineProps {
  startLedger: number;
  cliffLedger: number;
  endLedger: number;
  currentLedger?: number;
  /** Approximate seconds per ledger (Stellar mainnet ≈ 5 s) */
  secondsPerLedger?: number;
  /** Reference Date for ledger 0; defaults to now minus startLedger * secondsPerLedger */
  referenceDate?: Date;
  /** Token symbol for tooltip labels */
  tokenSymbol?: string;
  /** Optional CSS class name */
  className?: string;
}

interface TooltipState {
  x: number;
  y: number;
  ledger: number;
  label: string;
  date: string;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

const SECONDS_PER_LEDGER_DEFAULT = 5;
const LEDGERS_PER_DAY = Math.round((24 * 3600) / SECONDS_PER_LEDGER_DEFAULT);

function ledgerToDate(ledger: number, secondsPerLedger: number, referenceDate: Date): Date {
  const deltaMs = (ledger - 0) * secondsPerLedger * 1000;
  return new Date(referenceDate.getTime() + deltaMs);
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d);
}

function formatLedger(n: number): string {
  return n.toLocaleString();
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ── SVG Layout Constants ───────────────────────────────────────────────────────

const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 120;
const TRACK_Y = 60;
const TRACK_HEIGHT = 20;
const LABEL_Y_ABOVE = 38;
const LABEL_Y_BELOW = TRACK_Y + TRACK_HEIGHT + 16;
const PADDING_LEFT = 10;
const PADDING_RIGHT = 10;
const USABLE_WIDTH = VIEWBOX_WIDTH - PADDING_LEFT - PADDING_RIGHT;

// ── Component ──────────────────────────────────────────────────────────────────

export function SVGVestingTimeline({
  startLedger,
  cliffLedger,
  endLedger,
  currentLedger,
  secondsPerLedger = SECONDS_PER_LEDGER_DEFAULT,
  referenceDate,
  tokenSymbol = "tokens",
  className,
}: SVGVestingTimelineProps) {
  const uid = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // Validate
  const total = endLedger - startLedger;
  if (total <= 0 || cliffLedger <= startLedger || cliffLedger >= endLedger) {
    return (
      <p
        style={{ color: "#6b7280", fontSize: "0.875rem" }}
        data-testid="svg-timeline-invalid"
      >
        Invalid schedule — timeline cannot be rendered.
      </p>
    );
  }

  // ── Date helpers ──────────────────────────────────────────────────────────

  // If no referenceDate provided, estimate based on current time and currentLedger
  const anchorDate = referenceDate ?? (
    currentLedger != null
      ? new Date(Date.now() - (currentLedger * secondsPerLedger * 1000))
      : new Date(Date.now() - (startLedger * secondsPerLedger * 1000))
  );

  function ledgerInfo(ledger: number): { date: string } {
    const d = ledgerToDate(ledger, secondsPerLedger, anchorDate);
    return { date: formatDate(d) };
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  function ledgerToX(ledger: number): number {
    const pct = (ledger - startLedger) / total;
    return PADDING_LEFT + clamp(pct, 0, 1) * USABLE_WIDTH;
  }

  const xStart = ledgerToX(startLedger);
  const xCliff = ledgerToX(cliffLedger);
  const xEnd = ledgerToX(endLedger);
  const xCurrent = currentLedger != null ? ledgerToX(currentLedger) : null;

  const lockedWidth = xCliff - xStart;
  const drippingWidth = xEnd - xCliff;

  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

  const startDate = ledgerInfo(startLedger).date;
  const cliffDate = ledgerInfo(cliffLedger).date;
  const endDate = ledgerInfo(endLedger).date;

  const cliffDays = Math.round((cliffLedger - startLedger) / LEDGERS_PER_DAY);
  const totalDays = Math.round((endLedger - startLedger) / LEDGERS_PER_DAY);

  const descText = `Vesting timeline: locked from ledger ${formatLedger(startLedger)} to cliff at ledger ${formatLedger(cliffLedger)} (day ${cliffDays}), then linear drip until ledger ${formatLedger(endLedger)} (day ${totalDays}).`;

  // ── Tooltip handlers ──────────────────────────────────────────────────────

  function onHoverLedger(svgX: number, ledger: number, phaseLabel: string, svgY: number) {
    const { date } = ledgerInfo(ledger);
    setTooltip({ x: svgX, y: svgY, ledger, label: phaseLabel, date });
  }

  function clearTooltip() {
    setTooltip(null);
  }

  // ── Rendered ──────────────────────────────────────────────────────────────

  return (
    <figure
      style={{ width: "100%", margin: 0 }}
      aria-label="SVG vesting timeline"
      data-testid="svg-vesting-timeline"
      className={className}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        width="100%"
        height="100%"
        style={{ minWidth: 0, display: "block", overflow: "visible" }}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid="svg-timeline-svg"
      >
        {/* Accessibility: title + desc */}
        <title id={titleId}>Vesting Stream Timeline</title>
        <desc id={descId}>{descText}</desc>

        {/* ── Gradient / pattern defs ── */}
        <defs>
          {/* Locked region: muted grey */}
          <linearGradient id={`${uid}-locked-grad`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#9ca3af" />
            <stop offset="100%" stopColor="#d1d5db" />
          </linearGradient>

          {/* Claimable region: green */}
          <linearGradient id={`${uid}-drip-grad`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#059669" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>

          {/* Current position pulse animation */}
          <filter id={`${uid}-glow`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* ══ Phase 1: Locked ══════════════════════════════════════════════ */}
        <rect
          x={xStart}
          y={TRACK_Y}
          width={lockedWidth}
          height={TRACK_HEIGHT}
          rx={4}
          fill={`url(#${uid}-locked-grad)`}
          aria-label="Locked period"
          style={{ cursor: "crosshair" }}
          onMouseMove={(e) => {
            const svgBox = svgRef.current!.getBoundingClientRect();
            const relX = e.clientX - svgBox.left;
            const pct = (relX / svgBox.width);
            const ledger = Math.round(startLedger + pct * total);
            const clampedLedger = clamp(ledger, startLedger, cliffLedger - 1);
            const svgX = ledgerToX(clampedLedger);
            onHoverLedger(svgX, clampedLedger, "Locked", TRACK_Y);
          }}
          onMouseLeave={clearTooltip}
        />

        {/* ══ Phase 2: Claimable (Linear Drip) ════════════════════════════ */}
        <rect
          x={xCliff}
          y={TRACK_Y}
          width={drippingWidth}
          height={TRACK_HEIGHT}
          rx={4}
          fill={`url(#${uid}-drip-grad)`}
          aria-label="Claimable (linear drip) region"
          style={{ cursor: "crosshair" }}
          onMouseMove={(e) => {
            const svgBox = svgRef.current!.getBoundingClientRect();
            const relX = e.clientX - svgBox.left;
            const pct = relX / svgBox.width;
            const ledger = Math.round(startLedger + pct * total);
            const clampedLedger = clamp(ledger, cliffLedger, endLedger);
            const svgX = ledgerToX(clampedLedger);
            onHoverLedger(svgX, clampedLedger, "Linear Drip", TRACK_Y);
          }}
          onMouseLeave={clearTooltip}
        />

        {/* ══ Phase labels (inside bars) ═══════════════════════════════════ */}
        {/* "Locked" label — only render if bar is wide enough */}
        {lockedWidth > 60 && (
          <text
            x={xStart + lockedWidth / 2}
            y={TRACK_Y + TRACK_HEIGHT / 2 + 4}
            textAnchor="middle"
            fontSize="11"
            fill="#fff"
            fontWeight="600"
            pointerEvents="none"
            aria-hidden="true"
          >
            Locked
          </text>
        )}

        {/* "Linear Drip" label */}
        {drippingWidth > 80 && (
          <text
            x={xCliff + drippingWidth / 2}
            y={TRACK_Y + TRACK_HEIGHT / 2 + 4}
            textAnchor="middle"
            fontSize="11"
            fill="#fff"
            fontWeight="600"
            pointerEvents="none"
            aria-hidden="true"
          >
            Linear Drip
          </text>
        )}

        {/* ══ Cliff marker ═════════════════════════════════════════════════ */}
        <g aria-label={`Cliff at ledger ${formatLedger(cliffLedger)}, ${cliffDate}`}>
          {/* Vertical tick */}
          <line
            x1={xCliff}
            y1={TRACK_Y - 8}
            x2={xCliff}
            y2={TRACK_Y + TRACK_HEIGHT + 8}
            stroke="#b45309"
            strokeWidth="2"
            strokeDasharray="4 2"
          />
          {/* "Cliff" label above */}
          <text
            x={xCliff}
            y={LABEL_Y_ABOVE}
            textAnchor="middle"
            fontSize="11"
            fill="#b45309"
            fontWeight="600"
            aria-hidden="true"
          >
            Cliff
          </text>
        </g>

        {/* ══ Start / End ticks ════════════════════════════════════════════ */}
        {/* Start tick */}
        <g aria-label={`Start at ledger ${formatLedger(startLedger)}, ${startDate}`}>
          <line
            x1={xStart}
            y1={TRACK_Y + TRACK_HEIGHT}
            x2={xStart}
            y2={TRACK_Y + TRACK_HEIGHT + 6}
            stroke="#6b7280"
            strokeWidth="1.5"
          />
          <text
            x={xStart}
            y={LABEL_Y_BELOW}
            textAnchor="start"
            fontSize="10"
            fill="#6b7280"
            aria-hidden="true"
          >
            Start
          </text>
        </g>

        {/* End tick */}
        <g aria-label={`End at ledger ${formatLedger(endLedger)}, ${endDate}`}>
          <line
            x1={xEnd}
            y1={TRACK_Y + TRACK_HEIGHT}
            x2={xEnd}
            y2={TRACK_Y + TRACK_HEIGHT + 6}
            stroke="#6b7280"
            strokeWidth="1.5"
          />
          <text
            x={xEnd}
            y={LABEL_Y_BELOW}
            textAnchor="end"
            fontSize="10"
            fill="#6b7280"
            aria-hidden="true"
          >
            End
          </text>
        </g>

        {/* ══ Current ledger marker ════════════════════════════════════════ */}
        {xCurrent !== null && currentLedger != null && (
          <g
            aria-label={`Current ledger ${formatLedger(currentLedger)}, ${ledgerInfo(currentLedger).date}`}
            data-testid="current-ledger-marker"
          >
            {/* Glow circle */}
            <circle
              cx={xCurrent}
              cy={TRACK_Y + TRACK_HEIGHT / 2}
              r={10}
              fill="#1d6ae5"
              opacity={0.2}
              filter={`url(#${uid}-glow)`}
            >
              {/* Pulse animation */}
              <animate
                attributeName="r"
                values="8;13;8"
                dur="2s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.25;0.05;0.25"
                dur="2s"
                repeatCount="indefinite"
              />
            </circle>

            {/* Main marker dot */}
            <circle
              cx={xCurrent}
              cy={TRACK_Y + TRACK_HEIGHT / 2}
              r={6}
              fill="#1d6ae5"
              stroke="#fff"
              strokeWidth="2"
            />

            {/* "Now" label below */}
            <text
              x={xCurrent}
              y={LABEL_Y_BELOW}
              textAnchor="middle"
              fontSize="10"
              fill="#1d6ae5"
              fontWeight="700"
              aria-hidden="true"
            >
              Now
            </text>
          </g>
        )}

        {/* ══ Tooltip ══════════════════════════════════════════════════════ */}
        {tooltip && (
          <g
            aria-hidden="true"
            pointerEvents="none"
            data-testid="svg-tooltip"
            transform={`translate(${clamp(tooltip.x, 60, VIEWBOX_WIDTH - 100)}, ${tooltip.y - 48})`}
          >
            <rect
              x={-60}
              y={-6}
              width={130}
              height={44}
              rx={6}
              fill="#1f2937"
              opacity={0.92}
            />
            {/* Phase label */}
            <text
              x={5}
              y={10}
              textAnchor="middle"
              fontSize="10"
              fill="#f9fafb"
              fontWeight="700"
            >
              {tooltip.label}
            </text>
            {/* Ledger */}
            <text
              x={5}
              y={24}
              textAnchor="middle"
              fontSize="10"
              fill="#d1d5db"
            >
              Ledger {formatLedger(tooltip.ledger)}
            </text>
            {/* Date */}
            <text
              x={5}
              y={37}
              textAnchor="middle"
              fontSize="9"
              fill="#9ca3af"
            >
              {tooltip.date}
            </text>
          </g>
        )}
      </svg>

      {/* ── Legend ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          fontSize: "0.75rem",
          color: "#6b7280",
          marginTop: "0.5rem",
          flexWrap: "wrap",
        }}
        role="list"
        aria-label="Timeline legend"
      >
        <span role="listitem" style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span
            style={{
              display: "inline-block",
              width: 16,
              height: 10,
              background: "linear-gradient(90deg,#9ca3af,#d1d5db)",
              borderRadius: 2,
            }}
            aria-hidden="true"
          />
          Locked
        </span>
        <span role="listitem" style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
          <span
            style={{
              display: "inline-block",
              width: 16,
              height: 10,
              background: "linear-gradient(90deg,#059669,#34d399)",
              borderRadius: 2,
            }}
            aria-hidden="true"
          />
          Claimable ({tokenSymbol})
        </span>
        <span
          role="listitem"
          style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}
        >
          <span
            style={{
              display: "inline-block",
              width: 2,
              height: 12,
              background: "#b45309",
            }}
            aria-hidden="true"
          />
          Cliff (Day {cliffDays})
        </span>
        {xCurrent !== null && (
          <span role="listitem" style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                background: "#1d6ae5",
                borderRadius: "50%",
                border: "2px solid #fff",
                boxShadow: "0 0 0 2px #1d6ae5",
              }}
              aria-hidden="true"
            />
            Current position
          </span>
        )}
      </div>
    </figure>
  );
}
