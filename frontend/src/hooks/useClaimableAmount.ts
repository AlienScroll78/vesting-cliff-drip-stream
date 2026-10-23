/**
 * useClaimableAmount — real-time polling hook for claimable token balance.
 *
 * - Polls every `intervalMs` milliseconds (default 5000)
 * - Pauses polling when the tab is hidden (Page Visibility API)
 * - Shows loading skeleton on first load
 * - Graceful error state without crashing
 *
 * @closes #532
 */
import { useState, useEffect, useCallback, useRef } from 'react'

export interface UseClaimableAmountOptions {
  /** Recipient stellar address to query. If empty/undefined, polling is skipped. */
  recipient?: string
  /** Polling interval in ms. Defaults to 5000. */
  intervalMs?: number
  /** API base URL. Defaults to '/api'. */
  apiBase?: string
}

export interface UseClaimableAmountResult {
  amount: number | null
  loading: boolean
  error: string | null
  lastUpdated: Date | null
  /** Manually trigger a refresh */
  refresh: () => void
}

async function fetchClaimableAmount(apiBase: string, recipient: string): Promise<number> {
  const res = await fetch(`${apiBase}/streams/${encodeURIComponent(recipient)}/claimable`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json() as { claimable_amount?: number; amount?: number }
  return json.claimable_amount ?? json.amount ?? 0
}

export function useClaimableAmount({
  recipient,
  intervalMs = 5000,
  apiBase = '/api',
}: UseClaimableAmountOptions = {}): UseClaimableAmountResult {
  const [amount, setAmount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const isMounted = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const poll = useCallback(async () => {
    if (!recipient) {
      setLoading(false)
      return
    }
    try {
      const value = await fetchClaimableAmount(apiBase, recipient)
      if (!isMounted.current) return
      setAmount(value)
      setError(null)
      setLastUpdated(new Date())
    } catch (err) {
      if (!isMounted.current) return
      setError(err instanceof Error ? err.message : 'Failed to fetch claimable amount')
    } finally {
      if (isMounted.current) setLoading(false)
    }
  }, [recipient, apiBase])

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!document.hidden) poll().then(scheduleNext)
      else scheduleNext()
    }, intervalMs)
  }, [poll, intervalMs])

  useEffect(() => {
    isMounted.current = true
    setLoading(true)
    setAmount(null)
    setError(null)

    poll().then(scheduleNext)

    const handleVisibility = () => {
      if (!document.hidden) {
        // Tab became visible: poll immediately then resume schedule
        if (timerRef.current) clearTimeout(timerRef.current)
        poll().then(scheduleNext)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      isMounted.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [poll, scheduleNext])

  const refresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    poll().then(scheduleNext)
  }, [poll, scheduleNext])

  return { amount, loading, error, lastUpdated, refresh }
}
