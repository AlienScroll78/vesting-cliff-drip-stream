"use client";
import { useMemo } from "react";
import { VestingStream } from "@/types";
import { formatAmount } from "@/utils/formatAmount";
import { StatusBadge } from "./StatusBadge";
import {
  DataTable,
  DATA_TABLE_PAGE_SIZES,
  type DataTableColumn,
  type DataTablePageSize,
} from "./DataTable";

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

const DEFAULT_PAGE_SIZE: DataTablePageSize = 25;

function toPageSize(pageSize: number): DataTablePageSize {
  return DATA_TABLE_PAGE_SIZES.find((size) => size === pageSize) ?? DEFAULT_PAGE_SIZE;
}

function ledgerToDate(ledger: number | undefined): Date | null {
  if (!ledger) return null;
  const secondsFromNow = (ledger - 51_200_000) * 5;
  return new Date(Date.now() + secondsFromNow * 1000);
}

function formatLedgerDate(ledger: number | undefined): string {
  const date = ledgerToDate(ledger);
  return date ? date.toLocaleDateString() : "—";
}

function useSponsorColumns(
  onCancelStream?: (streamId: string) => void,
  onViewDetails?: (streamId: string) => void,
): DataTableColumn<VestingStream>[] {
  return useMemo(
    () => [
      {
        key: "recipient",
        header: "Recipient",
        sortType: "string",
        sortValue: (stream) => stream.recipient,
        render: (stream) => <code>{stream.recipient}</code>,
      },
      {
        key: "status",
        header: "Status",
        sortType: "string",
        sortValue: (stream) => stream.status,
        render: (stream) => <StatusBadge status={stream.status} />,
      },
      {
        key: "cliffDate",
        header: "Cliff Date",
        sortType: "date",
        sortValue: (stream) => ledgerToDate(stream.cliffLedger),
        render: (stream) => formatLedgerDate(stream.cliffLedger),
      },
      {
        key: "endDate",
        header: "End Date",
        sortType: "date",
        sortValue: (stream) => ledgerToDate(stream.endLedger),
        render: (stream) => formatLedgerDate(stream.endLedger),
      },
      {
        key: "claimable",
        header: "Claimable",
        sortType: "number",
        align: "right",
        sortValue: (stream) => stream.claimableAmount,
        render: (stream) => formatAmount(stream.claimableAmount),
      },
      {
        key: "actions",
        header: "Actions",
        sortable: false,
        render: (stream) => (
          <div onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => onViewDetails?.(stream.id)}
              aria-label={`View details for recipient ${stream.recipient}`}
            >
              View
            </button>
            <button
              type="button"
              onClick={() => onCancelStream?.(stream.id)}
              disabled={stream.status === "cancelled" || stream.status === "completed"}
              aria-label={`Cancel stream for recipient ${stream.recipient}`}
            >
              Cancel
            </button>
          </div>
        ),
      },
    ],
    [onCancelStream, onViewDetails],
  );
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
  const columns = useSponsorColumns(onCancelStream, onViewDetails);

  return (
    <DataTable<VestingStream>
      caption="Sponsor vesting streams"
      columns={columns}
      data={streams}
      getRowId={(stream) => stream.id}
      isLoading={isLoading}
      onRowClick={onViewDetails ? (stream) => onViewDetails(stream.id) : undefined}
      pagination={{ page, pageSize: toPageSize(pageSize), total, onPageChange }}
    />
  );
}
