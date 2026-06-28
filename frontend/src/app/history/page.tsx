"use client";
import { TxType } from "@/types";
import { useTransactions } from "@/hooks/useTransactions";

const STELLAR_EXPERT = "https://stellar.expert/explorer/testnet/tx";

const TYPE_LABELS: Record<TxType | "all", string> = {
  all: "All",
  claim: "Claim",
  create: "Create",
  cancel: "Cancel",
};

const TYPE_EMOJI: Record<TxType, string> = {
  claim: "💸",
  create: "🚀",
  cancel: "🛑",
};

/** Format an ISO timestamp in the user's local timezone. */
function localDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default function TransactionHistoryPage() {
  const { transactions, total, page, pageSize, loading, error, setPage, filter, setFilter } =
    useTransactions();

  const totalPages = Math.ceil(total / pageSize);

  return (
    <main className="page">
      <header className="header">
        <h1>Transaction History</h1>
        <a href="/" className="btn btn-outline" style={{ fontSize: "0.875rem" }}>
          ← Back
        </a>
      </header>

      {/* Type filter */}
      <div role="group" aria-label="Filter by type" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {(["all", "claim", "create", "cancel"] as (TxType | "all")[]).map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`btn ${filter === t ? "btn-primary" : "btn-outline"}`}
            style={{ padding: "0.35rem 1rem", fontSize: "0.875rem" }}
            aria-pressed={filter === t}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--color-cancelled)", marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {loading ? (
        <p aria-busy="true" style={{ textAlign: "center", padding: "2rem 0", color: "#6b7280" }}>
          Loading…
        </p>
      ) : transactions.length === 0 ? (
        <p style={{ textAlign: "center", padding: "2rem 0", color: "#6b7280" }}>
          No transactions found.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
            aria-label="Transaction history"
          >
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-border)", textAlign: "left" }}>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Counterparty</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr
                  key={tx.id}
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                  <td style={tdStyle}>
                    <span aria-hidden="true">{TYPE_EMOJI[tx.type]}</span>{" "}
                    {TYPE_LABELS[tx.type]}
                  </td>
                  <td style={tdStyle}>
                    {tx.amount.toLocaleString()} {tx.token}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: "0.8rem" }}>
                    {tx.counterparty}
                  </td>
                  <td style={tdStyle}>
                    <time dateTime={tx.timestamp}>{localDate(tx.timestamp)}</time>
                  </td>
                  <td style={tdStyle}>
                    <a
                      href={`${STELLAR_EXPERT}/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`View transaction ${tx.hash.slice(0, 8)} on Stellar Expert`}
                      style={{ color: "var(--color-active)", fontFamily: "monospace", fontSize: "0.78rem" }}
                    >
                      {tx.hash.slice(0, 8)}… ↗
                    </a>
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
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", marginTop: "1.5rem" }}
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
    </main>
  );
}

const thStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.65rem 0.75rem",
  verticalAlign: "middle",
};
