import type { VestingStream } from "@/types";

const HEADERS = [
  "ID",
  "Recipient",
  "Sponsor",
  "Token",
  "Rate",
  "Claimable",
  "Cliff Ledger",
  "End Ledger",
  "Total Deposit",
  "Status",
];

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function generateStreamsCsv(streams: VestingStream[]): string {
  const rows = streams.map((stream) =>
    [
      stream.id,
      stream.recipient,
      stream.sponsor,
      stream.token,
      stream.rate,
      stream.claimableAmount,
      stream.cliffLedger,
      stream.endLedger,
      stream.totalDeposit,
      stream.status,
    ]
      .map(csvCell)
      .join(","),
  );

  return [HEADERS.map(csvCell).join(","), ...rows].join("\n");
}

export function downloadCsv(csv: string, filename = "streams.csv"): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
