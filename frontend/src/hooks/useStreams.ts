import { useEffect, useState } from "react";
import { VestingStream, StreamStatus } from "@/types";

const PAGE_SIZE = 25;

const BASE_LEDGER = 51_200_000;

const MOCK_STREAMS: VestingStream[] = [
  { id: "1",  recipient: "GABC1…XYZ", sponsor: "GSPON…", token: "USDC", rate: 10, claimableAmount: 1500, status: "active",    startLedger: BASE_LEDGER - 172_800, cliffLedger: BASE_LEDGER - 86_400,  endLedger: BASE_LEDGER + 6_048_000, totalDeposit: 63_072_000 },
  { id: "2",  recipient: "GABC2…XYZ", sponsor: "GSPON…", token: "USDC", rate: 5,  claimableAmount: 0,    status: "pre-cliff", startLedger: BASE_LEDGER - 17_280,  cliffLedger: BASE_LEDGER + 259_200, endLedger: BASE_LEDGER + 2_592_000, totalDeposit: 12_960_000 },
  { id: "3",  recipient: "GABC3…XYZ", sponsor: "GSPON…", token: "XLM",  rate: 20, claimableAmount: 0,    status: "completed" },
  { id: "4",  recipient: "GABC4…XYZ", sponsor: "GSPON…", token: "USDC", rate: 8,  claimableAmount: 0,    status: "cancelled" },
  { id: "5",  recipient: "GABC5…XYZ", sponsor: "GSPON…", token: "USDC", rate: 15, claimableAmount: 2200, status: "active",    startLedger: BASE_LEDGER - 200_000, cliffLedger: BASE_LEDGER - 100_000, endLedger: BASE_LEDGER + 5_000_000, totalDeposit: 80_000_000 },
  { id: "6",  recipient: "GABC6…XYZ", sponsor: "GSPON…", token: "XLM",  rate: 3,  claimableAmount: 0,    status: "pre-cliff", startLedger: BASE_LEDGER - 5_000,   cliffLedger: BASE_LEDGER + 300_000, endLedger: BASE_LEDGER + 1_500_000, totalDeposit: 4_500_000 },
  { id: "7",  recipient: "GABC7…XYZ", sponsor: "GSPON…", token: "USDC", rate: 12, claimableAmount: 0,    status: "cancelled" },
  { id: "8",  recipient: "GABC8…XYZ", sponsor: "GSPON…", token: "USDC", rate: 7,  claimableAmount: 0,    status: "completed" },
  { id: "9",  recipient: "GABC9…XYZ", sponsor: "GSPON…", token: "XLM",  rate: 25, claimableAmount: 3100, status: "active",    startLedger: BASE_LEDGER - 300_000, cliffLedger: BASE_LEDGER - 200_000, endLedger: BASE_LEDGER + 4_000_000, totalDeposit: 100_000_000 },
  { id: "10", recipient: "GABC10…XYZ", sponsor: "GSPON…", token: "USDC", rate: 6, claimableAmount: 0,   status: "pre-cliff", startLedger: BASE_LEDGER - 10_000, cliffLedger: BASE_LEDGER + 150_000, endLedger: BASE_LEDGER + 1_200_000, totalDeposit: 7_200_000 },
];

export type StreamFilter = StreamStatus | "all";

interface UseStreamsResult {
  streams: VestingStream[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  filter: StreamFilter;
  setPage: (p: number) => void;
  setFilter: (f: StreamFilter) => void;
}

export function useStreams(): UseStreamsResult {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<StreamFilter>("all");
  const [streams, setStreams] = useState<VestingStream[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  function handleSetFilter(f: StreamFilter) {
    setFilter(f);
    setPage(1);
  }

  useEffect(() => {
    setLoading(true);
    // TODO: replace with real API call:
    // fetch(`/api/streams?page=${page}&pageSize=${PAGE_SIZE}&status=${filter}`)
    const filtered = filter === "all" ? MOCK_STREAMS : MOCK_STREAMS.filter((s) => s.status === filter);
    const start = (page - 1) * PAGE_SIZE;
    setTotal(filtered.length);
    setStreams(filtered.slice(start, start + PAGE_SIZE));
    setLoading(false);
  }, [page, filter]);

  return { streams, total, page, pageSize: PAGE_SIZE, loading, error, filter, setPage, setFilter: handleSetFilter };
}
