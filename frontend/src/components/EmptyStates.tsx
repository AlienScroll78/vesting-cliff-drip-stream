"use client";
import type { ReactNode } from "react";

// ── Base layout ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  illustration: ReactNode;
  heading: string;
  subtext: string;
  cta: ReactNode;
}

function EmptyState({ illustration, heading, subtext, cta }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "3rem 1.5rem",
        textAlign: "center",
        gap: "0.75rem",
      }}
    >
      <div style={{ marginBottom: "0.5rem" }}>{illustration}</div>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-text)", margin: 0 }}>
        {heading}
      </h2>
      <p style={{ fontSize: "0.9rem", color: "#6b7280", maxWidth: "26rem", margin: 0, lineHeight: 1.6 }}>
        {subtext}
      </p>
      <div style={{ marginTop: "0.5rem" }}>{cta}</div>
    </div>
  );
}

// ── SVG illustrations ─────────────────────────────────────────────────────────
// All use currentColor so they adapt to dark mode automatically.
// Stroke colours reference CSS vars; background fills use opacity so they
// stay readable on both light (#f9fafb) and dark (#0f172a) backgrounds.

function StreamsIllustration() {
  return (
    <svg
      width="120"
      height="100"
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="No streams illustration"
      role="img"
    >
      {/* Background circle */}
      <circle cx="60" cy="50" r="44" fill="var(--color-active)" fillOpacity="0.08" />
      {/* Coin stack */}
      <ellipse cx="60" cy="68" rx="22" ry="7" fill="var(--color-active)" fillOpacity="0.18" stroke="var(--color-active)" strokeWidth="1.5" />
      <ellipse cx="60" cy="60" rx="22" ry="7" fill="var(--color-surface)" stroke="var(--color-active)" strokeWidth="1.5" />
      <ellipse cx="60" cy="52" rx="22" ry="7" fill="var(--color-surface)" stroke="var(--color-active)" strokeWidth="1.5" />
      {/* Stream flow arrow */}
      <path d="M38 38 Q60 28 82 38" stroke="var(--color-active)" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" fill="none" />
      <polyline points="76,34 82,38 76,42" stroke="var(--color-active)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Plus circle */}
      <circle cx="60" cy="22" r="10" fill="var(--color-active)" />
      <line x1="60" y1="17" x2="60" y2="27" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="55" y1="22" x2="65" y2="22" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIllustration() {
  return (
    <svg
      width="120"
      height="100"
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="No transaction history illustration"
      role="img"
    >
      <circle cx="60" cy="50" r="44" fill="var(--color-pre-cliff)" fillOpacity="0.08" />
      {/* Clock face */}
      <circle cx="60" cy="50" r="26" fill="var(--color-surface)" stroke="var(--color-pre-cliff)" strokeWidth="2" />
      {/* Clock hands */}
      <line x1="60" y1="50" x2="60" y2="33" stroke="var(--color-pre-cliff)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="60" y1="50" x2="71" y2="57" stroke="var(--color-pre-cliff)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="60" cy="50" r="2.5" fill="var(--color-pre-cliff)" />
      {/* Tick marks */}
      <line x1="60" y1="25" x2="60" y2="29" stroke="var(--color-pre-cliff)" strokeWidth="2" strokeLinecap="round" />
      <line x1="60" y1="71" x2="60" y2="75" stroke="var(--color-pre-cliff)" strokeWidth="2" strokeLinecap="round" />
      <line x1="35" y1="50" x2="39" y2="50" stroke="var(--color-pre-cliff)" strokeWidth="2" strokeLinecap="round" />
      <line x1="81" y1="50" x2="85" y2="50" stroke="var(--color-pre-cliff)" strokeWidth="2" strokeLinecap="round" />
      {/* Mailbox flag */}
      <rect x="80" y="28" width="16" height="20" rx="2" fill="var(--color-surface)" stroke="var(--color-pre-cliff)" strokeWidth="1.5" />
      <line x1="88" y1="28" x2="88" y2="48" stroke="var(--color-pre-cliff)" strokeWidth="1.5" />
      <line x1="80" y1="38" x2="96" y2="38" stroke="var(--color-pre-cliff)" strokeWidth="1.5" />
      <path d="M96 33 L100 36 L96 39" stroke="var(--color-pre-cliff)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function SearchIllustration() {
  return (
    <svg
      width="120"
      height="100"
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="No search results illustration"
      role="img"
    >
      <circle cx="60" cy="50" r="44" fill="var(--color-completed)" fillOpacity="0.08" />
      {/* Magnifier */}
      <circle cx="52" cy="44" r="18" fill="var(--color-surface)" stroke="var(--color-completed)" strokeWidth="2.5" />
      <line x1="65" y1="57" x2="80" y2="72" stroke="var(--color-completed)" strokeWidth="3" strokeLinecap="round" />
      {/* X inside magnifier */}
      <line x1="44" y1="36" x2="60" y2="52" stroke="var(--color-completed)" strokeWidth="2" strokeLinecap="round" />
      <line x1="60" y1="36" x2="44" y2="52" stroke="var(--color-completed)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SponsorIllustration() {
  return (
    <svg
      width="120"
      height="100"
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="No sponsored streams illustration"
      role="img"
    >
      <circle cx="60" cy="50" r="44" fill="var(--color-active)" fillOpacity="0.08" />
      {/* Person silhouette */}
      <circle cx="60" cy="34" r="12" fill="var(--color-surface)" stroke="var(--color-active)" strokeWidth="2" />
      <path d="M36 72c0-13.3 10.7-24 24-24s24 10.7 24 24" stroke="var(--color-active)" strokeWidth="2" fill="none" />
      {/* Seedling / sprout */}
      <line x1="60" y1="80" x2="60" y2="64" stroke="var(--color-completed)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M60 74 Q70 68 72 58" stroke="var(--color-completed)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M60 70 Q50 64 48 54" stroke="var(--color-completed)" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ── Sponsor stream list (dashboard) ──────────────────────────────────────────

interface SponsorEmptyProps {
  onCreateStream: () => void;
}

export function SponsorStreamListEmpty({ onCreateStream }: SponsorEmptyProps) {
  return (
    <EmptyState
      illustration={<StreamsIllustration />}
      heading="Create your first stream"
      subtext="You haven't created any vesting streams yet. Start streaming tokens to a contributor and lock in their long-term alignment."
      cta={
        <button
          className="btn btn-primary"
          onClick={onCreateStream}
          data-testid="empty-create-stream"
        >
          + New Stream
        </button>
      }
    />
  );
}

// ── Transaction history ───────────────────────────────────────────────────────

export function TxHistoryEmpty() {
  return (
    <EmptyState
      illustration={<HistoryIllustration />}
      heading="No transactions yet"
      subtext="Transactions you submit — claims, stream creation, and cancellations — will appear here once you start interacting with the contract."
      cta={
        <a
          href="https://stellar.expert/explorer/testnet"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline"
          data-testid="empty-explore-stellar"
        >
          Explore Stellar Expert ↗
        </a>
      }
    />
  );
}

// ── Search no-results ─────────────────────────────────────────────────────────

interface SearchEmptyProps {
  onResetFilter: () => void;
}

export function SearchResultsEmpty({ onResetFilter }: SearchEmptyProps) {
  return (
    <EmptyState
      illustration={<SearchIllustration />}
      heading="No streams match your filter"
      subtext="Try adjusting your filter or search query — there may be streams under a different status."
      cta={
        <button
          className="btn btn-outline"
          onClick={onResetFilter}
          data-testid="empty-reset-filter"
        >
          Reset filter
        </button>
      }
    />
  );
}

// ── Recipient schedule ────────────────────────────────────────────────────────

interface RecipientEmptyProps {
  onContactSponsor?: () => void;
}

export function RecipientScheduleEmpty({ onContactSponsor }: RecipientEmptyProps) {
  return (
    <EmptyState
      illustration={<SearchIllustration />}
      heading="No schedule found"
      subtext="There's no active vesting stream for your wallet address. Ask your sponsor to create one, or double-check you're connected with the right wallet."
      cta={
        onContactSponsor ? (
          <button
            className="btn btn-primary"
            onClick={onContactSponsor}
            data-testid="empty-contact-sponsor"
          >
            Contact sponsor
          </button>
        ) : (
          <a
            href="https://docs.stellar.org"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline"
            data-testid="empty-learn-more"
          >
            Learn about vesting ↗
          </a>
        )
      }
    />
  );
}

// ── Sponsor dashboard (streams page) ─────────────────────────────────────────

export function SponsorDashboardEmpty() {
  return (
    <EmptyState
      illustration={<SponsorIllustration />}
      heading="You haven't created any streams"
      subtext="As a sponsor you can create vesting streams for contributors. Each stream deposits tokens upfront and drips them linearly after a cliff period."
      cta={
        <a href="/" className="btn btn-primary" data-testid="empty-create-stream">
          Create a stream →
        </a>
      }
    />
  );
}
