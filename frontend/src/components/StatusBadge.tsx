import { StreamStatus } from "@/types";
import { useTranslation } from "react-i18next";

const CONFIG: Record<StreamStatus, { key: string; className: string; symbol: string }> = {
  "active":    { key: "active",    className: "badge-active",    symbol: "●" },
  "pre-cliff": { key: "precliff",  className: "badge-pre-cliff", symbol: "◐" },
  "completed": { key: "completed", className: "badge-completed", symbol: "✓" },
  "cancelled": { key: "cancelled", className: "badge-cancelled", symbol: "✕" },
};

export function StatusBadge({ status }: { status: StreamStatus }) {
  const { t } = useTranslation();
  const { key, className, symbol } = CONFIG[status];
  const label = t(`status.${key}`);
  return (
    <span className={`badge ${className}`} aria-label={`Status: ${label}`}>
      <span aria-hidden="true">{symbol}</span> {label}
    </span>
  );
}

export function StatusLegend() {
  const { t } = useTranslation();
  return (
    <div className="legend" role="note" aria-label={t("legend")}>
      <span className="legend-title">{t("legend")}:</span>
      {(Object.keys(CONFIG) as StreamStatus[]).map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
    </div>
  );
}
