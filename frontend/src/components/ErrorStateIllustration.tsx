"use client";

import type { ErrorCategory } from "@/errorMessages";

interface ErrorStateIllustrationProps {
  category: ErrorCategory;
  /** Size in pixels for the SVG viewBox. Defaults to 80. */
  size?: number;
}

/**
 * Inline SVG illustrations for each error category.
 * All SVGs are decorative and marked aria-hidden="true".
 */
export function ErrorStateIllustration({
  category,
  size = 80,
}: ErrorStateIllustrationProps) {
  switch (category) {
    case "network":
      return <NetworkIllustration size={size} />;
    case "auth":
      return <AuthIllustration size={size} />;
    case "contract":
      return <ContractIllustration size={size} />;
    case "unexpected":
    default:
      return <UnexpectedIllustration size={size} />;
  }
}

// ── Network — disconnected plug (amber) ─────────────────────────────────────

function NetworkIllustration({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background circle */}
      <circle cx="40" cy="40" r="38" fill="#451A03" stroke="#F59E0B" strokeWidth="2" />

      {/* Plug body — left piece */}
      <rect x="14" y="35" width="18" height="10" rx="2" fill="#F59E0B" />
      <rect x="18" y="28" width="4" height="8" rx="1" fill="#F59E0B" />
      <rect x="24" y="28" width="4" height="8" rx="1" fill="#F59E0B" />

      {/* Plug body — right piece (disconnected, slightly offset) */}
      <rect x="48" y="35" width="18" height="10" rx="2" fill="#FCD34D" />
      <rect x="54" y="44" width="4" height="8" rx="1" fill="#FCD34D" />
      <rect x="60" y="44" width="4" height="8" rx="1" fill="#FCD34D" />

      {/* Gap / disconnect lines */}
      <line x1="33" y1="38" x2="36" y2="38" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
      <line x1="44" y1="42" x2="47" y2="42" stroke="#FCD34D" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />

      {/* X mark */}
      <line x1="36" y1="34" x2="44" y2="46" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="44" y1="34" x2="36" y2="46" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Auth — padlock (violet) ──────────────────────────────────────────────────

function AuthIllustration({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background circle */}
      <circle cx="40" cy="40" r="38" fill="#2E1065" stroke="#7C3AED" strokeWidth="2" />

      {/* Lock shackle (arc) */}
      <path
        d="M28 38 V30 C28 22.3 33.4 17 40 17 C46.6 17 52 22.3 52 30 V38"
        stroke="#A78BFA"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />

      {/* Lock body */}
      <rect x="23" y="37" width="34" height="26" rx="4" fill="#7C3AED" />

      {/* Keyhole circle */}
      <circle cx="40" cy="49" r="5" fill="#2E1065" />
      {/* Keyhole slot */}
      <rect x="38" y="49" width="4" height="7" rx="1" fill="#2E1065" />
    </svg>
  );
}

// ── Contract — document with warning (indigo/blue) ───────────────────────────

function ContractIllustration({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background circle */}
      <circle cx="40" cy="40" r="38" fill="#1E1B4B" stroke="#4F46E5" strokeWidth="2" />

      {/* Document body */}
      <rect x="22" y="14" width="28" height="38" rx="3" fill="#4F46E5" />
      {/* Folded corner */}
      <path d="M42 14 L50 22 L42 22 Z" fill="#312E81" />

      {/* Document lines */}
      <line x1="27" y1="28" x2="43" y2="28" stroke="#A5B4FC" strokeWidth="2" strokeLinecap="round" />
      <line x1="27" y1="34" x2="43" y2="34" stroke="#A5B4FC" strokeWidth="2" strokeLinecap="round" />
      <line x1="27" y1="40" x2="37" y2="40" stroke="#A5B4FC" strokeWidth="2" strokeLinecap="round" />

      {/* Warning triangle overlay */}
      <path
        d="M46 44 L62 44 L54 30 Z"
        fill="#F59E0B"
        stroke="#1E1B4B"
        strokeWidth="1.5"
      />
      {/* Exclamation mark */}
      <rect x="53" y="35" width="2" height="5" rx="1" fill="#1E1B4B" />
      <circle cx="54" cy="42" r="1" fill="#1E1B4B" />
    </svg>
  );
}

// ── Unexpected — question mark with shrug (red) ──────────────────────────────

function UnexpectedIllustration({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background circle */}
      <circle cx="40" cy="40" r="38" fill="#450A0A" stroke="#EF4444" strokeWidth="2" />

      {/* Question mark path */}
      <text
        x="40"
        y="52"
        textAnchor="middle"
        fontSize="44"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="#FCA5A5"
      >
        ?
      </text>
    </svg>
  );
}
