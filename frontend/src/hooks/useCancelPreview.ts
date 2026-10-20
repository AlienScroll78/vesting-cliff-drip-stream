"use client";
import { useState, useEffect } from "react";

export interface CancelPreview {
  recipientKeeps: number;
  sponsorRefund: number;
  cliffReached: boolean;
}

interface UseCancelPreviewResult {
  preview: CancelPreview | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the cancel impact preview from GET /api/streams/:recipient/cancel-preview.
 *
 * Returns how many tokens the recipient keeps (accrued since cliff) and how
 * many are refunded to the sponsor.  Falls back to a safe default if the
 * endpoint is unavailable.
 */
export function useCancelPreview(recipient: string | null): UseCancelPreviewResult {
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recipient) {
      setPreview(null);
      return;
    }

    let cancelled = false;

    async function fetchPreview() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/streams/${encodeURIComponent(recipient!)}/cancel-preview`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = (await res.json()) as CancelPreview;
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          // Surface the error but don't block the modal — show zeros as a safe fallback
          setError(err instanceof Error ? err.message : "Failed to load cancel preview");
          setPreview({ recipientKeeps: 0, sponsorRefund: 0, cliffReached: false });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPreview();
    return () => { cancelled = true; };
  }, [recipient]);

  return { preview, loading, error };
}
