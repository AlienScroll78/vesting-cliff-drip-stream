import { useEffect, useState } from "react";
import { VestingStream } from "@/types";
import { setCacheEntry, getCacheEntry } from "@/utils/indexedDbCache";
import { useOnlineStatus } from "./useOnlineStatus";

const CACHE_KEY = "vesting-streams";

interface CachedStreamsResult {
  streams: VestingStream[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  isCached: boolean;
  lastUpdated: number | null;
}

/**
 * Hook to fetch streams with automatic IndexedDB caching.
 * Falls back to cached data when offline.
 */
export function useCachedStreams(
  page: number,
  pageSize: number,
  filter: string,
  onlineFetch: () => Promise<{ streams: VestingStream[]; total: number }>
): CachedStreamsResult {
  const isOnline = useOnlineStatus();
  const [streams, setStreams] = useState<VestingStream[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchStreams() {
      setLoading(true);
      setError(null);

      try {
        if (isOnline) {
          // Try online fetch first
          const result = await onlineFetch();
          if (!cancelled) {
            setStreams(result.streams);
            setTotal(result.total);
            setIsCached(false);
            setLastUpdated(Date.now());

            // Cache the result
            await setCacheEntry(CACHE_KEY, {
              streams: result.streams,
              total: result.total,
              timestamp: Date.now(),
            });
          }
        } else {
          // Offline: try cache
          const cached = await getCacheEntry<{
            streams: VestingStream[];
            total: number;
            timestamp: number;
          }>(CACHE_KEY);

          if (cached) {
            if (!cancelled) {
              setStreams(cached.data.streams);
              setTotal(cached.data.total);
              setIsCached(true);
              setLastUpdated(cached.data.timestamp);
            }
          } else if (!cancelled) {
            setError("No cached data available. Please go online to fetch streams.");
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to fetch streams";
          setError(message);

          // On error, try to fall back to cache
          if (isOnline) {
            const cached = await getCacheEntry<{
              streams: VestingStream[];
              total: number;
              timestamp: number;
            }>(CACHE_KEY);

            if (cached && !cancelled) {
              setStreams(cached.data.streams);
              setTotal(cached.data.total);
              setIsCached(true);
              setLastUpdated(cached.data.timestamp);
              setError(null); // Clear error if cache available
            }
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchStreams();

    return () => {
      cancelled = true;
    };
  }, [page, pageSize, filter, isOnline, onlineFetch]);

  return {
    streams,
    total,
    page,
    pageSize,
    loading,
    error,
    isCached,
    lastUpdated,
  };
}
