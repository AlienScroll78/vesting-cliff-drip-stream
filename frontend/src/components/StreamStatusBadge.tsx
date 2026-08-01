/**
 * StreamStatusBadge — Issue #378
 *
 * Reusable badge component implementing all stream statuses defined in
 * docs/stream-status-badges.md, with distinct colors, icons, and optional
 * pulse animations for active states.
 *
 * Statuses:
 *   Pre-Cliff  → gray/amber  (locked period before cliff)
 *   Active     → green       (tokens dripping, animated pulse)
 *   Expired    → orange      (stream ended, unclaimed tokens remain)
 *   Cancelled  → red         (stream terminated by sponsor)
 *   Drained    → purple      (all tokens claimed)
 *   Paused     → yellow      (stream temporarily paused)
 *
 * Size variants: sm (tables), md (cards), lg (detail view)
 */

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamBadgeStatus =
  | "pre-cliff"
  | "active"
  | "expired"
  | "cancelled"
  | "drained"
  | "paused";

export type BadgeSize = "sm" | "md" | "lg";

export interface StreamStatusBadgeProps {
  /** The current stream status */
  status: StreamBadgeStatus;
  /** Size variant — sm for tables, md for cards, lg for detail views */
  size?: BadgeSize;
  /** Whether to show the tooltip on hover. Defaults to true. */
  showTooltip?: boolean;
  /** Additional CSS class names */
  className?: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

interface BadgeConfig {
  label: string;
  /** Short description shown in the tooltip */
  tooltip: string;
  /** Icon character / emoji (aria-hidden) */
  icon: string;
  /** Whether to show a pulsing ring animation */
  pulse: boolean;
  /** Inline style colors */
  colors: {
    background: string;
    text: string;
    border: string;
    pulseColor: string;
  };
}

const BADGE_CONFIG: Record<StreamBadgeStatus, BadgeConfig> = {
  "pre-cliff": {
    label: "Pre-Cliff",
    tooltip: "The cliff period has not yet been reached. Tokens are locked and cannot be claimed.",
    icon: "🔒",
    pulse: false,
    colors: {
      background: "#F3F4F6",
      text: "#6B7280",
      border: "#D1D5DB",
      pulseColor: "transparent",
    },
  },
  active: {
    label: "Active",
    tooltip: "Tokens are actively dripping and available to claim.",
    icon: "▶",
    pulse: true,
    colors: {
      background: "#DCFCE7",
      text: "#15803D",
      border: "#86EFAC",
      pulseColor: "#22C55E",
    },
  },
  expired: {
    label: "Expired",
    tooltip: "The stream period has ended. Unclaimed tokens may still be available.",
    icon: "⏱",
    pulse: false,
    colors: {
      background: "#FEF3C7",
      text: "#B45309",
      border: "#FCD34D",
      pulseColor: "transparent",
    },
  },
  cancelled: {
    label: "Cancelled",
    tooltip: "This stream was cancelled by the sponsor. No further tokens will accrue.",
    icon: "✕",
    pulse: false,
    colors: {
      background: "#FEE2E2",
      text: "#B91C1C",
      border: "#FCA5A5",
      pulseColor: "transparent",
    },
  },
  drained: {
    label: "Drained",
    tooltip: "All tokens have been claimed. The stream is fully settled.",
    icon: "✓",
    pulse: false,
    colors: {
      background: "#F3E8FF",
      text: "#7E22CE",
      border: "#C4B5FD",
      pulseColor: "transparent",
    },
  },
  paused: {
    label: "Paused",
    tooltip: "The stream is temporarily paused. Token accrual is suspended.",
    icon: "⏸",
    pulse: false,
    colors: {
      background: "#FEF9C3",
      text: "#854D0E",
      border: "#FDE047",
      pulseColor: "transparent",
    },
  },
};

// ─── Size tokens ──────────────────────────────────────────────────────────────

const SIZE_STYLES: Record<BadgeSize, React.CSSProperties> = {
  sm: { fontSize: "0.7rem", padding: "0.125rem 0.5rem", gap: "0.25rem", borderRadius: "9999px" },
  md: { fontSize: "0.8rem", padding: "0.25rem 0.65rem", gap: "0.35rem", borderRadius: "9999px" },
  lg: { fontSize: "0.95rem", padding: "0.35rem 0.85rem", gap: "0.45rem", borderRadius: "9999px" },
};

const PULSE_SIZE: Record<BadgeSize, { width: string; height: string }> = {
  sm: { width: "6px", height: "6px" },
  md: { width: "8px", height: "8px" },
  lg: { width: "10px", height: "10px" },
};

// ─── Pulse animation (injected once) ─────────────────────────────────────────

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
            whiteSpaceCollapse: "preserve",
          }}
        >
          {text}
          {/* Arrow */}
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

function PulseRing({ color, size }: { color: string; size: { width: string; height: string } }) {
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
 * Displays the status of a vesting stream with an icon, label, optional
 * pulse animation (active state), and a tooltip with a full description.
 *
 * @example
 * <StreamStatusBadge status="active" size="md" />
 * <StreamStatusBadge status="pre-cliff" size="sm" showTooltip={false} />
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
 * Renders a horizontal legend of all stream statuses.
 * Useful above or below stream list tables.
 */
export function StreamStatusLegend({ size = "sm" }: { size?: BadgeSize }) {
  const statuses = Object.keys(BADGE_CONFIG) as StreamBadgeStatus[];
  return (
    <div
      role="note"
      aria-label="Stream status legend"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        alignItems: "center",
      }}
    >
      {statuses.map((s) => (
        <StreamStatusBadge key={s} status={s} size={size} />
      ))}
    </div>
  );
}
