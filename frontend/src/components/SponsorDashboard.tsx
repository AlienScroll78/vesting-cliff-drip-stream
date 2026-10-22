"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CancelConfirmModal } from "@/components/CancelConfirmModal";
import { CopyButton } from "@/components/CopyButton";
import { StatusBadge } from "@/components/StatusBadge";
import type { StreamStatus, VestingStream } from "@/types";
import { formatAmount } from "@/utils/formatAmount";

interface SponsorStream {
  id: string;
  recipient: string;
  token: string;
  status: StreamStatus;
  totalDeposited: number;
  remainingAmount: number;
  claimedAmount: number;
  expiry: string;
  rate: number;
  cancelPreview: { recipientAmount: number; sponsorRefund: number; cliffReached: boolean };
  clawbackEligible: boolean;
}

type StatusFilter = "all" | "active" | "cancelled" | "completed";
const PAGE_SIZE = 10;
const API_BASE = import.meta.env.VITE_BACKEND_URL ?? "";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function downloadCsv(streams: SponsorStream[]) {
  const rows = [
    ["Recipient", "Token", "Status", "Total deposited", "Remaining", "Claimed", "Expiry"],
    ...streams.map((stream) => [
      stream.recipient,
      stream.token,
      stream.status,
      String(stream.totalDeposited),
      String(stream.remainingAmount),
      String(stream.claimedAmount),
      stream.expiry,
    ]),
  ];
  const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "sponsor-streams.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function SponsorDashboard({ address }: { address: string | null }) {
  const { t, i18n } = useTranslation();
  const [streams, setStreams] = useState<SponsorStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [cancelTarget, setCancelTarget] = useState<SponsorStream | null>(null);
  const [clawbackTarget, setClawbackTarget] = useState<SponsorStream | null>(null);
  const [clawbackReason, setClawbackReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setStreams([]);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    request<{ streams: SponsorStream[] }>(`${API_BASE}/sponsors/${encodeURIComponent(address)}/streams`, { signal: controller.signal })
      .then((result) => setStreams(result.streams))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("sponsorDashboard.loadError"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [address, t]);

  const filtered = useMemo(
    () => streams.filter((stream) => filter === "all" || stream.status === filter),
    [filter, streams],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleStreams = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totals = streams.reduce((sum, stream) => ({
    deposited: sum.deposited + stream.totalDeposited,
    remaining: sum.remaining + stream.remainingAmount,
    claimed: sum.claimed + stream.claimedAmount,
  }), { deposited: 0, remaining: 0, claimed: 0 });

  async function performAction(path: string, body?: object) {
    setActionError(null);
    try {
      await request(`${API_BASE}${path}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await request<{ streams: SponsorStream[] }>(`${API_BASE}/sponsors/${encodeURIComponent(address!)}/streams`);
      setStreams(result.streams);
      setCancelTarget(null);
      setClawbackTarget(null);
      setClawbackReason("");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("sponsorDashboard.actionError"));
    }
  }

  if (!address) return <p role="status">{t("sponsorDashboard.connectWallet")}</p>;
  if (loading) return <p role="status" aria-busy="true">{t("sponsorDashboard.loading")}</p>;

  return (
    <section aria-labelledby="sponsor-dashboard-title">
      <div className="sponsor-dashboard-heading">
        <h2 id="sponsor-dashboard-title">{t("sponsorDashboard.title")}</h2>
        <button type="button" className="btn btn-outline" onClick={() => downloadCsv(streams)} disabled={streams.length === 0}>
          {t("sponsorDashboard.exportCsv")}
        </button>
      </div>
      {error && <p role="alert" className="sponsor-dashboard-error">{t("sponsorDashboard.loadError")}: {error}</p>}
      {actionError && <p role="alert" className="sponsor-dashboard-error">{t("sponsorDashboard.actionError")}: {actionError}</p>}
      <dl className="sponsor-dashboard-totals">
        <div><dt>{t("sponsorDashboard.deposited")}</dt><dd>{formatAmount(totals.deposited, i18n.language)}</dd></div>
        <div><dt>{t("sponsorDashboard.remaining")}</dt><dd>{formatAmount(totals.remaining, i18n.language)}</dd></div>
        <div><dt>{t("sponsorDashboard.claimed")}</dt><dd>{formatAmount(totals.claimed, i18n.language)}</dd></div>
      </dl>
      <div className="sponsor-dashboard-controls">
        <label htmlFor="sponsor-status-filter">{t("sponsorDashboard.filter")}</label>
        <select id="sponsor-status-filter" value={filter} onChange={(event) => { setFilter(event.target.value as StatusFilter); setPage(1); }}>
          {(["all", "active", "cancelled", "completed"] as const).map((status) => <option key={status} value={status}>{t(`sponsorDashboard.status.${status}`)}</option>)}
        </select>
      </div>
      {streams.length === 0 ? <p>{t("sponsorDashboard.empty")}</p> : filtered.length === 0 ? <p>{t("sponsorDashboard.noFilteredStreams")}</p> : (
        <div className="sponsor-dashboard-table-wrap">
          <table className="sponsor-dashboard-table">
            <thead><tr>
              <th>{t("recipient")}</th><th>{t("sponsorDashboard.token")}</th><th>{t("sponsorDashboard.status")}</th>
              <th>{t("sponsorDashboard.remaining")}</th><th>{t("sponsorDashboard.expiry")}</th><th>{t("sponsorDashboard.actions")}</th>
            </tr></thead>
            <tbody>{visibleStreams.map((stream) => (
              <tr key={stream.id}>
                <td><span className="sponsor-dashboard-recipient">{stream.recipient.slice(0, 6)}…{stream.recipient.slice(-6)} <CopyButton text={stream.recipient} label={t("sponsorDashboard.copyRecipient")} /></span></td>
                <td>{stream.token}</td>
                <td><StatusBadge status={stream.status} /></td>
                <td>{formatAmount(stream.remainingAmount, i18n.language)}</td>
                <td>{stream.expiry}</td>
                <td className="sponsor-dashboard-actions">
                  {stream.status === "active" && <button type="button" className="btn btn-outline" onClick={() => setCancelTarget(stream)}>{t("sponsorDashboard.cancel")}</button>}
                  {stream.clawbackEligible && <button type="button" className="btn btn-outline" onClick={() => setClawbackTarget(stream)}>{t("sponsorDashboard.clawback")}</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {pageCount > 1 && <nav className="sponsor-dashboard-pagination" aria-label={t("sponsorDashboard.pagination")}>
        <button type="button" className="btn btn-outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>{t("sponsorDashboard.previous")}</button>
        <span>{t("sponsorDashboard.page", { page, pages: pageCount })}</span>
        <button type="button" className="btn btn-outline" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>{t("sponsorDashboard.next")}</button>
      </nav>}
      {cancelTarget && <CancelConfirmModal
        stream={{ id: cancelTarget.id, recipient: cancelTarget.recipient, sponsor: address, token: cancelTarget.token, rate: cancelTarget.rate, claimableAmount: cancelTarget.cancelPreview.recipientAmount, status: cancelTarget.status } satisfies VestingStream}
        amounts={cancelTarget.cancelPreview}
        onConfirm={() => performAction(`/sponsors/${encodeURIComponent(address)}/streams/${encodeURIComponent(cancelTarget.recipient)}/cancel`)}
        onClose={() => setCancelTarget(null)}
      />}
      {clawbackTarget && <div className="sponsor-dashboard-modal-backdrop" role="presentation" onClick={() => setClawbackTarget(null)}>
        <form className="sponsor-dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="clawback-title" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void performAction(`/sponsors/${encodeURIComponent(address)}/streams/${encodeURIComponent(clawbackTarget.recipient)}/clawback`, { reason: clawbackReason }); }}>
          <h2 id="clawback-title">{t("sponsorDashboard.clawbackTitle")}</h2>
          <label htmlFor="clawback-reason">{t("sponsorDashboard.reason")}</label>
          <textarea id="clawback-reason" value={clawbackReason} onChange={(event) => setClawbackReason(event.target.value)} required rows={3} />
          <div className="sponsor-dashboard-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setClawbackTarget(null)}>{t("cancel")}</button>
            <button type="submit" className="btn btn-primary">{t("sponsorDashboard.clawback")}</button>
          </div>
        </form>
      </div>}
    </section>
  );
}
