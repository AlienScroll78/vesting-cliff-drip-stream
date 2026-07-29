"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n";

const ADMIN_TOKEN_KEY = "admin_token";
const REFRESH_INTERVAL = 30_000;

interface IndexerStats {
  status: "ok" | "degraded" | "down";
  lastLedger: number;
  errorRate: string;
  recentEvents: { id: string; type: string; ledger: number; ts: string }[];
}

// Stub — replace with real API call
async function fetchStats(_token: string): Promise<IndexerStats> {
  return {
    status: "ok",
    lastLedger: 51_203_447,
    errorRate: "0.02%",
    recentEvents: [
      { id: "1", type: "stream_created", ledger: 51_203_440, ts: "2026-06-26T08:00:00Z" },
      { id: "2", type: "tokens_claimed", ledger: 51_203_443, ts: "2026-06-26T08:01:00Z" },
    ],
  };
}

async function triggerReindex(_token: string): Promise<void> {
  // stub — replace with real API call
  await new Promise((r) => setTimeout(r, 500));
}

export default function AdminPage() {
  const { t } = useTranslation();
  const [token, setToken] = useState<string>(() =>
    typeof window !== "undefined" ? (localStorage.getItem(ADMIN_TOKEN_KEY) ?? "") : ""
  );
  const [inputToken, setInputToken] = useState("");
  const [stats, setStats] = useState<IndexerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async (t: string) => {
    setLoading(true);
    try {
      const data = await fetchStats(t);
      setStats(data);
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    load(token);
    intervalRef.current = setInterval(() => load(token), REFRESH_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [token]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem(ADMIN_TOKEN_KEY, inputToken);
    setToken(inputToken);
  };

  const handleReindex = async () => {
    setReindexing(true);
    try { await triggerReindex(token); await load(token); }
    finally { setReindexing(false); }
  };

  if (!token) {
    return (
      <main style={{ maxWidth: 400, margin: "4rem auto", padding: "1rem" }}>
        <h1>{t("admin.title")}</h1>
        <p style={{ color: "var(--color-cancelled)", marginBottom: "1rem" }}>{t("admin.accessDenied")}</p>
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <label htmlFor="admin-token">{t("admin.enterToken")}</label>
          <input
            id="admin-token"
            type="password"
            value={inputToken}
            onChange={(e) => setInputToken(e.target.value)}
            required
            style={{ padding: "0.5rem", borderRadius: "0.25rem", border: "1px solid var(--color-border)" }}
          />
          <button type="submit" className="btn btn-primary">{t("admin.submit")}</button>
        </form>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1>{t("admin.title")}</h1>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            {t("admin.autoRefresh")}
            {lastRefresh && <> — {lastRefresh.toLocaleTimeString()}</>}
          </span>
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleReindex}
            disabled={reindexing}
            aria-busy={reindexing}
          >
            {reindexing ? "…" : t("admin.reindex")}
          </button>
        </div>
      </div>

      {loading && !stats && <p>Loading…</p>}

      {stats && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
            <StatCard label={t("admin.indexerStatus")}>
              <span style={{ color: stats.status === "ok" ? "var(--color-completed)" : "var(--color-cancelled)", fontWeight: 700 }}>
                {stats.status.toUpperCase()}
              </span>
            </StatCard>
            <StatCard label={t("admin.lastLedger")}>{stats.lastLedger.toLocaleString()}</StatCard>
            <StatCard label={t("admin.errorRate")}>{stats.errorRate}</StatCard>
          </div>

          <section>
            <h2 style={{ marginBottom: "0.75rem" }}>{t("admin.recentEvents")}</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr>
                  {["Type", "Ledger", "Time"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--color-border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.recentEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--color-border)" }}>{ev.type}</td>
                    <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--color-border)", fontFamily: "monospace" }}>{ev.ledger.toLocaleString()}</td>
                    <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--color-border)" }}>{new Date(ev.ts).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "0.5rem", padding: "1rem" }}>
      <div style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{children}</div>
    </div>
  );
}
