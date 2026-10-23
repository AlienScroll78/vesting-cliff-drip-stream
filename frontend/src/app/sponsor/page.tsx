"use client";
/**
 * Sponsor dashboard — #776
 *
 * Shows all vesting streams the connected wallet has sponsored.
 * Includes the full cancel stream flow: preview modal → address confirmation →
 * transaction signing → optimistic status update with rollback on failure.
 */
import { useState, useCallback, useEffect } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { VestingStream } from "@/types";
import { AggregateStats } from "@/components/AggregateStats";
import { SponsorStreamTable } from "@/components/SponsorStreamTable";
import { CancelStreamModal } from "@/components/CancelStreamModal";
import { ClawbackStreamModal } from "@/components/ClawbackStreamModal";
import { CreateStreamWizard } from "@/wizard/CreateStreamWizard";
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
  const { address } = useWallet();

  const [streams, setStreams] = useState<VestingStream[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [cancelTargetStream, setCancelTargetStream] = useState<VestingStream | null>(null);
  const [clawbackTargetStream, setClawbackTargetStream] = useState<VestingStream | null>(null);
  const [clawbackCompleted, setClawbackCompleted] = useState(false);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, page]);

  const handleExportCsv = useCallback(() => {
    const csv = generateStreamsCsv(streams);
    const filename = `sponsor-streams-${new Date().toISOString().split("T")[0]}.csv`;
    downloadCsv(csv, filename);
  }, [streams]);

  const handleCancelStream = useCallback((streamId: string) => {
    setCancelTargetStream(streams.find((stream) => stream.id === streamId) ?? null);
  }, [streams]);

  const handleCancelSuccess = useCallback((streamId: string) => {
    setStreams((current) =>
      current.map((stream) =>
        stream.id === streamId ? { ...stream, status: "cancelled" } : stream
      )
    );
    setCancelTargetStream(null);
  }, []);

  const handleClawbackStream = useCallback((streamId: string) => {
    setClawbackTargetStream(streams.find((stream) => stream.id === streamId) ?? null);
    setClawbackCompleted(false);
  }, [streams]);

  const submitClawback = useCallback(async (
    stream: VestingStream,
    reason: string,
  ): Promise<number> => {
    if (!address) throw new Error("Connect the sponsoring wallet to continue.");
    if (stream.streamId === undefined) {
      throw new Error("The on-chain stream identifier is unavailable. Refresh the stream data and try again.");
    }

    const response = await fetch(
      `/api/streams/${encodeURIComponent(stream.recipient)}/build-clawback-tx`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sponsor: address,
          stream_id: stream.streamId,
          reason,
        }),
      },
    );
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      transaction_xdr?: string;
      amount?: number | string;
    };
    if (!response.ok || !body.transaction_xdr || body.amount === undefined) {
      throw new Error(body.error ?? `Unable to build clawback transaction (${response.status}).`);
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("The clawback service returned an invalid recovered amount.");
    }

    const { signTransaction } = await import("@stellar/freighter-api");
    const signed = await signTransaction(body.transaction_xdr, {
      networkPassphrase:
        process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
        "Test SDF Network ; September 2015",
    });
    if ("error" in signed && signed.error) throw new Error(String(signed.error));
    const signedXdr =
      "signedTxXdr" in signed
        ? signed.signedTxXdr
        : (signed as { signedXdr?: string }).signedXdr ?? body.transaction_xdr;
    const submitResponse = await fetch("/api/tx/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xdr: signedXdr }),
    });
    const submitBody = await submitResponse.json().catch(() => ({})) as { error?: string };
    if (!submitResponse.ok) {
      throw new Error(submitBody.error ?? `Clawback transaction failed (${submitResponse.status}).`);
    }

    setClawbackCompleted(true);
    return amount;
  }, [address]);

  const handleClawbackClose = useCallback(() => {
    if (clawbackCompleted && clawbackTargetStream) {
      setStreams((current) =>
        current.filter((stream) => stream.id !== clawbackTargetStream.id)
      );
      setTotal((current) => Math.max(current - 1, 0));
    }
    setClawbackCompleted(false);
    setClawbackTargetStream(null);
  }, [clawbackCompleted, clawbackTargetStream]);

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
        <SponsorStreamListEmpty onCreateStream={() => setShowCreate(true)} />
        {showCreate && <CreateStreamWizard onClose={() => setShowCreate(false)} />}
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
        onClawbackStream={handleClawbackStream}
        onViewDetails={handleViewDetails}
      />

      {cancelTargetStream && (
        <CancelStreamModal
          stream={cancelTargetStream}
          onSuccess={handleCancelSuccess}
          onClose={() => setCancelTargetStream(null)}
        />
      )}
      {clawbackTargetStream && (
        <ClawbackStreamModal
          stream={clawbackTargetStream}
          onClawback={submitClawback}
          onClose={handleClawbackClose}
        />
      )}
    </div>
  );
}
