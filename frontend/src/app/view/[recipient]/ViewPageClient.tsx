"use client";
import { useEffect, useState, useCallback } from "react";
import { CopyButton } from "@/components/CopyButton";
import { StatusBadge } from "@/components/StatusBadge";
import { VestingStream } from "@/types";

// Stub lookup — replace with real contract read
async function fetchSchedule(recipient: string): Promise<VestingStream | null> {
  if (!recipient.startsWith("G") || recipient.length < 10) return null;
  return {
    id: "demo",
    recipient,
    sponsor: "GXYZ…",
    token: "USDC",
    rate: 10,
    claimableAmount: 1500,
    status: "active",
  };
}

export default function ViewPageClient({ recipient }: { recipient: string }) {
  const [stream, setStream] = useState<VestingStream | null | undefined>(undefined);
  const [urlCopied, setUrlCopied] = useState(false);

  useEffect(() => {
    fetchSchedule(recipient).then(setStream);
  }, [recipient]);

  const copyShareUrl = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setUrlCopied(true);
    setTimeout(() => setUrlCopied(false), 2000);
  }, []);

  if (stream === undefined) {
    return <main className="page"><p>Loading…</p></main>;
  }

  if (stream === null) {
    return (
      <main className="page">
        <h1 style={{ marginBottom: "0.5rem" }}>Schedule not found</h1>
        <p style={{ color: "#6b7280" }}>
          No vesting schedule was found for <code>{recipient}</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <h1>Vesting Schedule</h1>
        <button
          type="button"
          className="btn btn-outline"
          onClick={copyShareUrl}
          aria-label={urlCopied ? "Link copied!" : "Copy share link"}
        >
          {urlCopied ? "✓ Copied!" : "Share"}
        </button>
      </header>

      <section className="stream-card" style={{ flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
              {stream.recipient}
              <CopyButton text={stream.recipient} label="Copy recipient address" />
            </div>
            <div style={{ marginTop: "0.25rem" }}>
              <StatusBadge status={stream.status} />
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: "1.5rem" }}>
              {stream.claimableAmount.toLocaleString()} {stream.token}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>claimable</div>
          </div>
        </div>

        <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem", fontSize: "0.875rem" }}>
          <dt style={{ color: "#6b7280" }}>Drip rate</dt>
          <dd>{stream.rate} tokens / ledger</dd>
          <dt style={{ color: "#6b7280" }}>Sponsor</dt>
          <dd style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontFamily: "monospace" }}>
            {stream.sponsor}
            <CopyButton text={stream.sponsor} label="Copy sponsor address" />
          </dd>
        </dl>
      </section>
    </main>
  );
}
