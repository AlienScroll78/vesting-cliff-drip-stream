import { StreamStatus } from "@/types";

const CONFIG: Record<StreamStatus, { label: string; className: string; symbol: string }> = {
  "active":    { label: "Active",      className: "badge-active",    symbol: "●" },
  "pre-cliff": { label: "Pre-cliff",   className: "badge-pre-cliff", symbol: "◐" },
  "completed": { label: "Completed",   className: "badge-completed", symbol: "✓" },
  "cancelled": { label: "Cancelled",   className: "badge-cancelled", symbol: "✕" },
};

export function StatusBadge({ status }: { status: StreamStatus }) {
  const { label, className, symbol } = CONFIG[status];
  return (
    <span className={`badge ${className}`} aria-label={`Status: ${label}`}>
      <span aria-hidden="true">{symbol}</span> {label}
    </span>
  );
}

export function StatusLegend() {
  return (
    <div className="legend" role="note" aria-label="Stream status legend">
      <span className="legend-title">Legend:</span>
      {(Object.keys(CONFIG) as StreamStatus[]).map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
    </div>
  );
}
