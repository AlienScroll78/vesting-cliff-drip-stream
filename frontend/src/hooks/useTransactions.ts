import { useEffect, useState } from "react";
import { Transaction, TxType } from "@/types";

const PAGE_SIZE = 10;

const TX_TYPES: TxType[] = ["claim", "create", "cancel"];

// Stub data — replace `fetch` call below with real API endpoint.
const MOCK_TXS: Transaction[] = Array.from({ length: 35 }, (_, i) => ({
  id: String(i + 1),
  type: TX_TYPES[i % 3]!,
  amount: (i + 1) * 150,
  token: "USDC",
  hash: `tx${String(i + 1).padStart(2, "0")}${"a".repeat(60)}`,
  timestamp: new Date(Date.now() - i * 3_600_000).toISOString(),
  counterparty: `G${"ABCDEFGHIJKLMNOP"[i % 16]}XY…`,
}));

interface UseTransactionsResult {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  setPage: (p: number) => void;
  filter: TxType | "all";
  setFilter: (f: TxType | "all") => void;
}

export function useTransactions(): UseTransactionsResult {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<TxType | "all">("all");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset to page 1 whenever filter changes
  function handleSetFilter(f: TxType | "all") {
    setFilter(f);
    setPage(1);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);

    // TODO: replace stub with real API call:
    // fetch(`/api/transactions?page=${page}&pageSize=${PAGE_SIZE}&type=${filter}`)
    //   .then(r => r.json()).then(({ data, total }) => { setTransactions(data); setTotal(total); })
    //   .catch(e => setError(e.message))
    //   .finally(() => setLoading(false));

    const filtered = filter === "all" ? MOCK_TXS : MOCK_TXS.filter((t) => t.type === filter);
    const start = (page - 1) * PAGE_SIZE;
    setTotal(filtered.length);
    setTransactions(filtered.slice(start, start + PAGE_SIZE));
    setLoading(false);
  }, [page, filter]);

  return { transactions, total, page, pageSize: PAGE_SIZE, loading, error, setPage, filter, setFilter: handleSetFilter };
}
