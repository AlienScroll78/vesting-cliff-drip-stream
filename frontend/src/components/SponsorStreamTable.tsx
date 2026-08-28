"use client";
import { useTranslation } from "react-i18next";
import { VestingStream } from "@/types";
import { formatAmount } from "@/utils/formatAmount";
import { StatusBadge } from "./StatusBadge";
import styles from "./SponsorStreamTable.module.css";

interface SponsorStreamTableProps {
  streams: VestingStream[];
  page: number;
  pageSize: number;
  total: number;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
  onCancelStream?: (streamId: string) => void;
  onViewDetails?: (streamId: string) => void;
}

/**
 * Table displaying sponsor's vesting streams with pagination and actions.
 * Shows: recipient, status, cliff date, end date, claimable amount, actions.
 */
export function SponsorStreamTable({
  streams,
  page,
  pageSize,
  total,
  isLoading = false,
  onPageChange,
  onCancelStream,
  onViewDetails,
}: SponsorStreamTableProps) {
  const { t } = useTranslation();
  const totalPages = Math.ceil(total / pageSize);

  const formatLedgerDate = (ledger: number | undefined): string => {
    if (!ledger) return "—";
    // Approximate: ~5 second block time on Stellar
    const secondsFromNow = (ledger - 51_200_000) * 5;
    const date = new Date(Date.now() + secondsFromNow * 1000);
    return date.toLocaleDateString();
  };

  return (
    <div className={styles.container}>
      {isLoading ? (
        <div className={styles.skeleton} aria-hidden="true" />
      ) : (
        <>
          <div className={styles.tableWrapper}>
            <table className={styles.table} role="grid" aria-label="Sponsor vesting streams">
              <thead>
                <tr>
                  <th scope="col">Recipient</th>
                  <th scope="col">Status</th>
                  <th scope="col">Cliff Date</th>
                  <th scope="col">End Date</th>
                  <th scope="col">Claimable</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {streams.map((stream) => (
                  <tr key={stream.id}>
                    <td>
                      <code className={styles.address}>{stream.recipient}</code>
                    </td>
                    <td>
                      <StatusBadge status={stream.status} />
                    </td>
                    <td>{formatLedgerDate(stream.cliffLedger)}</td>
                    <td>{formatLedgerDate(stream.endLedger)}</td>
                    <td className={styles.amount}>{formatAmount(stream.claimableAmount)}</td>
                    <td className={styles.actions}>
                      <button
                        className={styles.buttonSmall}
                        onClick={() => onViewDetails?.(stream.id)}
                        aria-label={`View details for recipient ${stream.recipient}`}
                      >
                        View
                      </button>
                      <button
                        className={styles.buttonSmallDanger}
                        onClick={() => onCancelStream?.(stream.id)}
                        disabled={stream.status === "cancelled" || stream.status === "completed"}
                        aria-label={`Cancel stream for recipient ${stream.recipient}`}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className={styles.pagination} role="navigation" aria-label="Pagination">
            <button
              className={styles.pageButton}
              onClick={() => onPageChange(1)}
              disabled={page === 1}
              aria-label="Go to first page"
            >
              ⟨⟨
            </button>
            <button
              className={styles.pageButton}
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              aria-label="Go to previous page"
            >
              ⟨
            </button>

            <div className={styles.pageInfo}>
              Page <span aria-live="polite">{page}</span> of {totalPages}
            </div>

            <button
              className={styles.pageButton}
              onClick={() => onPageChange(page + 1)}
              disabled={page === totalPages}
              aria-label="Go to next page"
            >
              ⟩
            </button>
            <button
              className={styles.pageButton}
              onClick={() => onPageChange(totalPages)}
              disabled={page === totalPages}
              aria-label="Go to last page"
            >
              ⟩⟩
            </button>
          </div>
        </>
      )}
    </div>
  );
}
