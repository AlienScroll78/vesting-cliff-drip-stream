"use client";
import type { ReactNode } from "react";

// ── Base empty state ──────────────────────────────────────────────────────────

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
      <div aria-hidden="true" style={{ fontSize: "3rem", lineHeight: 1 }}>
        {illustration}
      </div>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-text, #111827)", margin: 0 }}>
        {heading}
      </h2>
      <p style={{ fontSize: "0.9rem", color: "#6b7280", maxWidth: "26rem", margin: 0 }}>
        {subtext}
      </p>
      <div style={{ marginTop: "0.5rem" }}>{cta}</div>
    </div>
  );
}

// ── Sponsor stream list ───────────────────────────────────────────────────────

interface SponsorEmptyProps {
  onCreateStream: () => void;
}

export function SponsorStreamListEmpty({ onCreateStream }: SponsorEmptyProps) {
  return (
    <EmptyState
      illustration="🌱"
      heading="No streams yet"
      subtext="You haven't created any vesting streams. Create one to start streaming tokens to a contributor."
      cta={
        <button
          className="btn btn-primary"
          onClick={onCreateStream}
          data-testid="empty-create-stream"
        >
          Create your first stream
        </button>
      }
    />
  );
}

// ── Transaction history ───────────────────────────────────────────────────────

export function TxHistoryEmpty() {
  return (
    <EmptyState
      illustration="📭"
      heading="No transactions yet"
      subtext="Transactions you submit — claims, stream creation, and cancellations — will appear here."
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

// ── Recipient schedule ────────────────────────────────────────────────────────

interface RecipientEmptyProps {
  onContactSponsor?: () => void;
}

export function RecipientScheduleEmpty({ onContactSponsor }: RecipientEmptyProps) {
  return (
    <EmptyState
      illustration="🔍"
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
