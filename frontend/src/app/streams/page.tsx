"use client";
import { useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { SponsorStreamListEmpty } from "@/components/EmptyStates";
import { StreamListSkeleton } from "@/components/Skeletons";
import { CancelConfirmModal } from "@/components/CancelConfirmModal";
import { useStreams, StreamFilter } from "@/hooks/useStreams";
import { VestingStream, StreamStatus } from "@/types";
import { abbreviateAmount } from "@/utils/formatAmount";

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(streams: VestingStream[]) {
  const header = ["ID", "Recipient", "Token", "Rate", "Cliff Ledger", "End Ledger", "Status"];
  const rows = streams.map((s) => [
    s.id,
    s.recipient,
    s.token,
    String(s.rate),
    String(s.cliffLedger ?? ""),
    String(s.endLedger ?? ""),
    s.status,
  ]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "streams.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Cancel amounts helper ─────────────────────────────────────────────────────

function computeCancelAmounts(s: VestingStream) {
  const cliffReached = s.status === "active";
  const recipientAmount = cliffReached ? s.claimableAmount : 0;
  const total = s.totalDeposit ?? s.rate * 300;
  const sponsorRefund = Math.max(0, total - recipientAmount);
  return { recipientAmount, sponsorRefund, cliffReached };
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const FILTERS: { value: StreamFilter; label: string }[] = [
  { value: "all",       label: "All" },
  { value: "active",    label: "Active" },
  { value: "pre-cliff", label: "Pre-cliff" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

// ── Table styles ──────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  fontWeight: 700,
  whiteSpace: "nowrap",
  textAlign: "left",
};

const tdStyle: React.CSSProperties = {
  padding: "0.65rem 0.75rem",
  verticalAlign: "middle",
};

// ── Page component ────────────────────────────────────────────────────────────

export default function SponsorStreamsPage() {
  const { streams, total, page, pageSize, loading, error, filter, setPage, setFilter } =
    useStreams();
  const [cancelTarget, setCancelTarget] = useState<VestingStream | null>(null);

  const totalPages = Math.ceil(total / pageSize);

  async function handleCancel() {
    setCancelTarget(null);
    // TODO: submit cancel tx
    await Promise.resolve();
  }

  return (
    <main id="main-content" className="page">
      <header className="header">
        <h1>My Streams</h1>
        <a href="/" className="btn btn-outline" style={{ fontSize: "0.875rem" }}>
          ← Back
        </a>
      </header>

      {/* Filter + Export row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <div role="group" aria-label="Filter by status" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`btn ${filter === value ? "btn-primary" : "btn-outline"}`}
              style={{ padding: "0.35rem 1rem", fontSize: "0.875rem" }}
              aria-pressed={filter === value}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          className="btn btn-outline"
          style={{ fontSize: "0.875rem" }}
          onClick={() => exportCsv(streams)}
          disabled={streams.length === 0}
          aria-label="Export streams to CSV"
          data-testid="export-csv-btn"
        >
          ↓ Export CSV
        </button>
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--color-cancelled)", marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {loading ? (
        <StreamListSkeleton count={5} />
      ) : streams.length === 0 ? (
        <SponsorStreamListEmpty onCreateStream={() => { window.location.href = "/"; }} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
            aria-label="Sponsor streams"
            data-testid="streams-table"
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                <th style={thStyle}>Recipient</th>
                <th style={thStyle}>Token</th>
                <th style={thStyle}>Rate / ledger</th>
                <th style={thStyle}>Cliff ledger</th>
                <th style={thStyle}>End ledger</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((s) => (
                <tr
                  key={s.id}
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                  data-testid={`stream-row-${s.id}`}
                >
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.8rem" }}>
                    {s.recipient}
                  </td>
                  <td style={tdStyle}>{s.token}</td>
                  <td style={tdStyle}>{abbreviateAmount(s.rate)}</td>
                  <td style={tdStyle}>{s.cliffLedger?.toLocaleString() ?? "—"}</td>
                  <td style={tdStyle}>{s.endLedger?.toLocaleString() ?? "—"}</td>
                  <td style={tdStyle}>
                    <StatusBadge status={s.status as StreamStatus} />
                  </td>
                  <td style={tdStyle}>
                    {s.status === "active" || s.status === "pre-cliff" ? (
                      <button
                        className="btn btn-outline"
                        style={{
                          padding: "0.25rem 0.75rem",
                          fontSize: "0.8rem",
                          borderColor: "var(--color-cancelled)",
                          color: "var(--color-cancelled)",
                        }}
                        onClick={() => setCancelTarget(s)}
                        data-testid={`cancel-btn-${s.id}`}
                        aria-label={`Cancel stream for ${s.recipient}`}
                      >
                        Cancel
                      </button>
                    ) : (
                      <span style={{ color: "#9ca3af", fontSize: "0.8rem" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.75rem",
            marginTop: "1.5rem",
          }}
        >
          <button
            className="btn btn-outline"
            style={{ padding: "0.35rem 0.875rem" }}
            onClick={() => setPage(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span style={{ fontSize: "0.875rem" }}>
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-outline"
            style={{ padding: "0.35rem 0.875rem" }}
            onClick={() => setPage(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
          >
            ›
          </button>
        </nav>
      )}

      {cancelTarget && (
        <CancelConfirmModal
          stream={cancelTarget}
          amounts={computeCancelAmounts(cancelTarget)}
          onConfirm={handleCancel}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </main>
  );
}
