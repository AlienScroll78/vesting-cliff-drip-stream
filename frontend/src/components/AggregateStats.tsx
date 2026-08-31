"use client";
import { VestingStream } from "@/types";
import { formatAmount } from "@/utils/formatAmount";
import styles from "./AggregateStats.module.css";

interface AggregateStatsProps {
  streams: VestingStream[];
  isLoading?: boolean;
}

/**
 * Display aggregate statistics for sponsor streams:
 * - Active streams count
 * - Total tokens locked
 * - Total claimable by recipients
 */
export function AggregateStats({ streams, isLoading = false }: AggregateStatsProps) {
  const activeCount = streams.filter((s) => s.status === "active").length;

  const totalLocked = streams.reduce((sum, s) => sum + (s.totalDeposit || 0), 0);

  const totalClaimable = streams.reduce((sum, s) => sum + s.claimableAmount, 0);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.skeleton} aria-hidden="true" />
        <div className={styles.skeleton} aria-hidden="true" />
        <div className={styles.skeleton} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={styles.container} role="region" aria-label="Sponsor statistics">
      <div className={styles.stat}>
        <div className={styles.label}>Active Streams</div>
        <div className={styles.value}>{activeCount}</div>
      </div>

      <div className={styles.stat}>
        <div className={styles.label}>Total Locked</div>
        <div className={styles.value} title={totalLocked.toString()}>
          {formatAmount(totalLocked)}
        </div>
      </div>

      <div className={styles.stat}>
        <div className={styles.label}>Total Claimable</div>
        <div className={styles.value} title={totalClaimable.toString()}>
          {formatAmount(totalClaimable)}
        </div>
      </div>
    </div>
  );
}
