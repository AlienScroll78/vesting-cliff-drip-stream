"use client";
/**
 * Sponsor dashboard — #776
 *
 * Shows all vesting streams the connected wallet has sponsored.
 * Includes the full cancel stream flow: preview modal → address confirmation →
 * transaction signing → optimistic status update with rollback on failure.
 */
import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/contexts/WalletContext";
import { VestingStream } from "@/types";
import { AggregateStats } from "@/components/AggregateStats";
import { SponsorStreamTable } from "@/components/SponsorStreamTable";
import { CancelStreamModal } from "@/components/CancelStreamModal";
import { generateStreamsCsv, downloadCsv } from "@/utils/exportCsv";
import { SponsorStreamListEmpty } from "@/components/EmptyStates";
import styles from "./sponsor.module.css";

const PAGE_SIZE = 25;

export default function SponsorPage() {
  const { t } = useTranslation();
  const { address } = useWallet();

  const [streams, setStreams] = useState<VestingStream[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cancel modal state — null means modal is closed
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const cancelTargetStream = streams.find((s) => s.id === cancelTargetId) ?? null;

  // Mock data – replace with real API call
  const MOCK_SPONSOR_STREAMS: VestingStream[] = [
    {
      id: "1",
      recipient: "GABC1EXAMPLERECIPIENTADDRESSXYZ",
      sponsor: address || "GSPON…",
      token: "USDC",
      rate: 10,
      claimableAmount: 1500,
      status: "active",
      startLedger: 51_027_200,
      cliffLedger: 51_113_600,
      endLedger: 57_248_000,
      totalDeposit: 63_072_000,
    },
    {
      id: "2",
      recipient: "GDEF2EXAMPLERECIPIENTADDRESSXYZ",
      sponsor: address || "GSPON…",
      token: "USDC",
      rate: 5,
      claimableAmount: 0,
      status: "pre-cliff",
      startLedger: 51_182_800,
      cliffLedger: 51_459_600,
      endLedger: 53_792_800,
      totalDeposit: 12_960_000,
    },
    {
      id: "3",
      recipient: "GHIJ3EXAMPLERECIPIENTADDRESSXYZ",
      sponsor: address || "GSPON…",
      token: "XLM",
      rate: 20,
      claimableAmount: 0,
      status: "completed",
      totalDeposit: 5_000_000,
    },
  ];

  // Fetch sponsor streams
  useEffect(() => {
    if (!address) {
      setStreams([]);
      setTotal(0);
      return;
    }

    async function fetchStreams() {
      setLoading(true);
      setError(null);

      try {
        // TODO: Replace mock with real API call:
        // GET /api/schedules/sponsor/:address?page=X&pageSize=Y
        const filtered = MOCK_SPONSOR_STREAMS;
        const start = (page - 1) * PAGE_SIZE;
        setTotal(filtered.length);
        setStreams(filtered.slice(start, start + PAGE_SIZE));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch streams";
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    fetchStreams();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, page]);

  const handleExportCsv = useCallback(() => {
    const csv = generateStreamsCsv(streams);
    const filename = `sponsor-streams-${new Date().toISOString().split("T")[0]}.csv`;
    downloadCsv(csv, filename);
  }, [streams]);

  // Open the cancel confirmation modal
  const handleCancelStream = useCallback((streamId: string) => {
    setCancelTargetId(streamId);
  }, []);

  // Optimistic status update after successful cancellation
  const handleCancelSuccess = useCallback((streamId: string) => {
    setStreams((prev) =>
      prev.map((s) => s.id === streamId ? { ...s, status: "cancelled" } : s)
    );
    setCancelTargetId(null);
  }, []);

  const handleCancelClose = useCallback(() => {
    setCancelTargetId(null);
  }, []);

  const handleViewDetails = useCallback((_streamId: string) => {
    // TODO: Navigate to stream details page
  }, []);

  if (!address) {
    return (
      <div className={styles.container}>
        <div role="alert" className={styles.alert}>
          <p>Please connect your wallet to view your sponsored streams.</p>
        </div>
      </div>
    );
  }

  if (streams.length === 0 && !loading) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>{t("sponsor.title", "My Sponsored Streams")}</h1>
        <SponsorStreamListEmpty />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t("sponsor.title", "My Sponsored Streams")}</h1>
        {streams.length > 0 && (
          <button
            className={styles.exportButton}
            onClick={handleExportCsv}
            aria-label="Export streams to CSV"
          >
            📥 Export CSV
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}

      <AggregateStats streams={streams} isLoading={loading} />

      <SponsorStreamTable
        streams={streams}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        isLoading={loading}
        onPageChange={setPage}
        onCancelStream={handleCancelStream}
        onViewDetails={handleViewDetails}
      />

      {/* Cancel stream confirmation modal — rendered portal-style at page root */}
      {cancelTargetStream && (
        <CancelStreamModal
          stream={cancelTargetStream}
          onSuccess={handleCancelSuccess}
          onClose={handleCancelClose}
        />
      )}
    </div>
  );
}
