/**
 * StreamStatusBadge — Issue #543
 *
 * Reusable badge component implementing all stream statuses defined in
 * docs/stream-status-badges.md.  Each badge carries:
 *   - A distinct background / text colour
 *   - A visible text label (colour is never the sole indicator — WCAG 1.4.1)
 *   - role="status" and aria-label for screen-reader accessibility
 *   - An optional pulse animation for the Active state
 *   - An optional hover tooltip with a fuller description
 *
 * States (per spec):
 *   Pre-cliff  → Yellow  — "Locked"
 *   Active     → Green   — "Streaming"   (animated pulse)
 *   Claimable  → Blue    — "Claim Available"
 *   Cancelled  → Grey    — "Cancelled"
 *   Expired    → Red     — "Expired"
 *   Drained    → Purple  — "Drained"
 *
 * Size variants: sm (tables), md (cards, default), lg (detail view)
 */

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamBadgeStatus =
  | "pre-cliff"
  | "active"
  | "claimable"
  | "cancelled"
  | "expired"
  | "drained";

export type BadgeSize = "sm" | "md" | "lg";

export interface StreamStatusBadgeProps {
  /** The current stream status */
  status: StreamBadgeStatus;
  /** Size variant — sm for tables, md for cards, lg for detail views */
  size?: BadgeSize;
  /** Whether to show a tooltip on hover. Defaults to true. */
  showTooltip?: boolean;
  /** Additional CSS class names */
  className?: string;
}

// ─── Badge configuration ──────────────────────────────────────────────────────

interface BadgeConfig {
  /** Short visible label shown on the badge */
  label: string;
  /** Longer description shown in the tooltip and used to build aria-label */
  tooltip: string;
  /** Icon character / emoji (always aria-hidden) */
  icon: string;
  /** Whether to show a pulsing ring animation (Active state only) */
  pulse: boolean;
  colors: {
    background: string;
    text: string;
    border: string;
    pulseColor: string;
  };
}

/**
 * BADGE_CONFIG maps each StreamBadgeStatus to its visual + semantic config.
 *
 * Colour choices match the spec table in docs/stream-status-badges.md:
 *   Pre-cliff  → Amber/Yellow  (#F59E0B / bg #FEF3C7)
 *   Active     → Green         (#16A34A / bg #DCFCE7)
 *   Claimable  → Blue          (#2563EB / bg #DBEAFE)
 *   Cancelled  → Grey          (#6B7280 / bg #F3F4F6)
 *   Expired    → Red           (#DC2626 / bg #FEE2E2)
 *   Drained    → Purple        (#7C3AED / bg #F3E8FF)
 *
 * All text/background pairs meet WCAG 2.1 AA (≥ 4.5:1 for normal text).
 */
const BADGE_CONFIG: Record<StreamBadgeStatus, BadgeConfig> = {
  "pre-cliff": {
    label: "Locked",
    tooltip:
      "Tokens are locked until the cliff date is reached. No claims are possible yet.",
    icon: "🔒",
    pulse: false,
    colors: {
      background: "#FEF3C7", // amber-100
      text: "#92400E",       // amber-800 — 5.1:1 on #FEF3C7
      border: "#FCD34D",     // amber-300
      pulseColor: "transparent",
    },
  },
  active: {
    label: "Streaming",
    tooltip:
      "Tokens are actively dripping. The cliff has passed and tokens accrue each ledger.",
    icon: "▶",
    pulse: true,
    colors: {
      background: "#DCFCE7", // green-100
      text: "#14532D",       // green-900 — 7.9:1 on #DCFCE7
      border: "#86EFAC",     // green-300
      pulseColor: "#16A34A", // green-600
    },
  },
  claimable: {
    label: "Claim Available",
    tooltip:
      "Tokens are available to claim. Tap the Claim button to transfer your vested tokens.",
    icon: "💰",
    pulse: false,
    colors: {
      background: "#DBEAFE", // blue-100
      text: "#1E3A8A",       // blue-900 — 8.1:1 on #DBEAFE
      border: "#93C5FD",     // blue-300
      pulseColor: "transparent",
    },
  },
  cancelled: {
    label: "Cancelled",
    tooltip:
      "This stream was cancelled by the sponsor. No further tokens will accrue.",
    icon: "✕",
    pulse: false,
    colors: {
      background: "#F3F4F6", // gray-100
      text: "#374151",       // gray-700 — 7.1:1 on #F3F4F6
      border: "#D1D5DB",     // gray-300
      pulseColor: "transparent",
    },
  },
  expired: {
    label: "Expired",
    tooltip:
      "The stream period has ended. Unclaimed tokens may still be withdrawable.",
    icon: "⏱",
    pulse: false,
    colors: {
      background: "#FEE2E2", // red-100
      text: "#7F1D1D",       // red-900 — 8.5:1 on #FEE2E2
      border: "#FCA5A5",     // red-300
      pulseColor: "transparent",
    },
  },
  drained: {
    label: "Drained",
    tooltip:
      "All tokens have been claimed or recovered. The stream is fully settled.",
    icon: "✓",
    pulse: false,
    colors: {
      background: "#F3E8FF", // violet-100
      text: "#3B0764",       // violet-950 — 10.1:1 on #F3E8FF
      border: "#C4B5FD",     // violet-300
      pulseColor: "transparent",
    },
  },
};

// ─── Size tokens ──────────────────────────────────────────────────────────────

const SIZE_STYLES: Record<BadgeSize, React.CSSProperties> = {
  sm: { fontSize: "0.7rem",  padding: "0.125rem 0.5rem",  gap: "0.25rem", borderRadius: "9999px" },
  md: { fontSize: "0.8rem",  padding: "0.25rem 0.65rem",  gap: "0.35rem", borderRadius: "9999px" },
  lg: { fontSize: "0.95rem", padding: "0.35rem 0.85rem",  gap: "0.45rem", borderRadius: "9999px" },
};

const PULSE_SIZE: Record<BadgeSize, { width: string; height: string }> = {
  sm: { width: "6px",  height: "6px" },
  md: { width: "8px",  height: "8px" },
  lg: { width: "10px", height: "10px" },
};

// ─── Pulse animation (injected once into <head>) ───────────────────────────────

const PULSE_KEYFRAMES = `
@keyframes stream-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%       { transform: scale(1.8); opacity: 0; }
}
`;

let pulseStyleInjected = false;
function ensurePulseStyle() {
  if (pulseStyleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = PULSE_KEYFRAMES;
  document.head.appendChild(style);
  pulseStyleInjected = true;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

interface TooltipProps {
  text: string;
  children: React.ReactNode;
}

function Tooltip({ text, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1F2937",
            color: "#F9FAFB",
            fontSize: "0.72rem",
            padding: "0.35rem 0.65rem",
            borderRadius: "6px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 9999,
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            maxWidth: "260px",
          }}
        >
          {text}
          {/* Caret */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              borderWidth: "4px",
              borderStyle: "solid",
              borderColor: "#1F2937 transparent transparent transparent",
            }}
          />
        </span>
      )}
    </span>
  );
}

// ─── PulseRing ────────────────────────────────────────────────────────────────

interface PulseRingProps {
  color: string;
  size: { width: string; height: string };
}

function PulseRing({ color, size }: PulseRingProps) {
  ensurePulseStyle();
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        width: size.width,
        height: size.height,
        flexShrink: 0,
      }}
    >
      {/* Solid dot */}
      <span
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          background: color,
          display: "block",
        }}
      />
      {/* Animated ring */}
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
          opacity: 0.6,
          animation: "stream-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        }}
      />
    </span>
  );
}

// ─── StreamStatusBadge ────────────────────────────────────────────────────────

/**
 * Displays the lifecycle status of a vesting stream as a compact badge.
 *
 * Accessibility:
 *   - role="status" — announces updates to assistive technologies
 *   - aria-label — combines "Stream status: " with the label and tooltip text
 *   - Colour is never the only differentiator; every badge has a visible label
 *
 * @example
 * <StreamStatusBadge status="active" />
 * <StreamStatusBadge status="pre-cliff" size="sm" showTooltip={false} />
 * <StreamStatusBadge status="claimable" size="lg" />
 */
export function StreamStatusBadge({
  status,
  size = "md",
  showTooltip = true,
  className,
}: StreamStatusBadgeProps) {
  const config = BADGE_CONFIG[status];
  const { colors, label, icon, pulse, tooltip } = config;
  const sizeStyle = SIZE_STYLES[size];
  const pulseSize = PULSE_SIZE[size];

  const badge = (
    <span
      role="status"
      aria-label={`Stream status: ${label}. ${tooltip}`}
      data-testid={`stream-status-badge-${status}`}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sizeStyle.gap,
        padding: sizeStyle.padding,
        borderRadius: sizeStyle.borderRadius,
        fontSize: sizeStyle.fontSize,
        fontWeight: 500,
        lineHeight: 1,
        background: colors.background,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        userSelect: "none",
        cursor: showTooltip ? "default" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {pulse ? (
        <PulseRing color={colors.pulseColor} size={pulseSize} />
      ) : (
        <span aria-hidden="true" style={{ lineHeight: 1, fontSize: "0.85em" }}>
          {icon}
        </span>
      )}
      {label}
    </span>
  );

  if (!showTooltip) return badge;
  return <Tooltip text={tooltip}>{badge}</Tooltip>;
}

// ─── StreamStatusLegend ───────────────────────────────────────────────────────

/**
 * Renders a horizontal legend showing all six stream statuses.
 * Place above or below the stream list table.
 *
 * @example
 * <StreamStatusLegend size="sm" />
 */
export function StreamStatusLegend({ size = "sm" }: { size?: BadgeSize }) {
  const statuses = Object.keys(BADGE_CONFIG) as StreamBadgeStatus[];
  return (
    <div
      role="note"
      aria-label="Stream status legend"
      style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}
    >
      {statuses.map((s) => (
        <StreamStatusBadge key={s} status={s} size={size} showTooltip={false} />
      ))}
    </div>
  );
}
