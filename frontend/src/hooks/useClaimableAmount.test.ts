/**
 * Tests for useClaimableAmount
 * @closes #532
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useClaimableAmount } from './useClaimableAmount'

describe('useClaimableAmount', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ claimable_amount: 1500 }),
    } as Response)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('returns loading:true on first render', async () => {
    const { result } = renderHook(() =>
      useClaimableAmount({ recipient: 'GABC1', intervalMs: 5000 })
    )
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  test('fetches claimable amount and sets it', async () => {
    const { result } = renderHook(() =>
      useClaimableAmount({ recipient: 'GABC1', intervalMs: 5000 })
    )
    await waitFor(() => expect(result.current.amount).toBe(1500))
    expect(result.current.error).toBeNull()
  })

  test('sets error state on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() =>
      useClaimableAmount({ recipient: 'GABC1', intervalMs: 5000 })
    )
    await waitFor(() => expect(result.current.error).toBe('Network error'))
    expect(result.current.loading).toBe(false)
  })

  test('does not fetch when recipient is empty', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const { result } = renderHook(() =>
      useClaimableAmount({ recipient: '', intervalMs: 5000 })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('polls again after interval', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ claimable_amount: 2000 }),
    } as Response)
    renderHook(() => useClaimableAmount({ recipient: 'GABC1', intervalMs: 1000 }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    await act(async () => { vi.advanceTimersByTime(1100) })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
  })

  test('pauses polling when tab is hidden', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ claimable_amount: 500 }),
    } as Response)
    Object.defineProperty(document, 'hidden', { value: false, writable: true })
    renderHook(() => useClaimableAmount({ recipient: 'GABC1', intervalMs: 1000 }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    Object.defineProperty(document, 'hidden', { value: true, writable: true })
    await act(async () => { vi.advanceTimersByTime(3000) })
    // Should not have fetched again since tab is hidden
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('resumes polling when tab becomes visible', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ claimable_amount: 500 }),
    } as Response)
    Object.defineProperty(document, 'hidden', { value: true, writable: true })
    renderHook(() => useClaimableAmount({ recipient: 'GABC1', intervalMs: 1000 }))
    await act(async () => { vi.advanceTimersByTime(2000) })
    Object.defineProperty(document, 'hidden', { value: false, writable: true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
  })
})
