"use client";
import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useWallet } from "@/contexts/WalletContext";
import { VestingStream } from "@/types";
import { AggregateStats } from "@/components/AggregateStats";
import { SponsorStreamTable } from "@/components/SponsorStreamTable";
import { generateStreamsCsv, downloadCsv } from "@/utils/exportCsv";
import { SponsorStreamListEmpty } from "@/components/EmptyStates";
import styles from "./sponsor.module.css";

const PAGE_SIZE = 25;

/**
 * Sponsor dashboard showing all vesting streams created by the connected wallet.
 * Features:
 * - Aggregate stats (active, total locked, total claimable)
 * - Paginated table with recipient, status, dates, claimable amount
 * - CSV export
 * - Cancel stream action (sponsor only)
 * - Empty state with CTA
 */
export default function SponsorPage() {
  const { t } = useTranslation();
  const { address } = useWallet();

  const [streams, setStreams] = useState<VestingStream[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mock data - replace with API call
  const MOCK_SPONSOR_STREAMS: VestingStream[] = [
    {
      id: "1",
      recipient: "GABC1…XYZ",
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
      recipient: "GDEF2…XYZ",
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
      recipient: "GHIJ3…XYZ",
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
        // TODO: Replace with real API call
        // const response = await fetch(
        //   `/api/schedules/sponsor/${address}?page=${page}&pageSize=${PAGE_SIZE}`
        // );
        // const data = await response.json();

        // Mock: filter by sponsor
        const filtered = MOCK_SPONSOR_STREAMS.filter(
          (s) => s.sponsor === address
        );
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
  }, [address, page]);

  const handleExportCsv = useCallback(() => {
    const csv = generateStreamsCsv(streams);
    const filename = `sponsor-streams-${new Date().toISOString().split("T")[0]}.csv`;
    downloadCsv(csv, filename);
  }, [streams]);

  const handleCancelStream = useCallback((streamId: string) => {
    // TODO: Implement cancel stream action
    console.log("Cancel stream:", streamId);
    alert(`Implement cancel stream for ${streamId}`);
  }, []);

  const handleViewDetails = useCallback((streamId: string) => {
    // TODO: Navigate to stream details
    console.log("View details:", streamId);
    alert(`Navigate to stream details for ${streamId}`);
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
        <h1 className={styles.title}>My Sponsored Streams</h1>
        <SponsorStreamListEmpty />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>My Sponsored Streams</h1>
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
    </div>
  );
}
