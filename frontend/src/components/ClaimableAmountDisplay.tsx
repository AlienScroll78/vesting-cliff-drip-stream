/**
 * ClaimableAmountDisplay — live-updating claimable balance widget.
 *
 * Shows a loading skeleton on first load, the current claimable amount
 * when available, and a user-friendly error state on failure.
 *
 * @closes #532
 */
import { useClaimableAmount } from '../hooks/useClaimableAmount'

interface Props {
  recipient: string
  intervalMs?: number
}

export function ClaimableAmountDisplay({ recipient, intervalMs = 5000 }: Props) {
  const { amount, loading, error, lastUpdated, refresh } = useClaimableAmount({
    recipient,
    intervalMs,
  })

  if (loading && amount === null) {
    return (
      <div
        role="status"
        aria-label="Loading claimable balance"
        aria-busy="true"
        style={{
          display: 'inline-block',
          width: '8rem',
          height: '1.25rem',
          background: 'linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s infinite',
          borderRadius: '0.25rem',
        }}
      />
    )
  }

  if (error) {
    return (
      <span role="alert" style={{ color: 'var(--color-cancelled, #dc2626)', fontSize: '0.875rem' }}>
        ⚠ Failed to load balance.{' '}
        <button
          type="button"
          onClick={refresh}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textDecoration: 'underline', padding: 0, font: 'inherit' }}
          aria-label="Retry loading claimable balance"
        >
          Retry
        </button>
      </span>
    )
  }

  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Claimable balance: ${amount?.toLocaleString() ?? 0} tokens`}
    >
      <strong>{amount?.toLocaleString() ?? 0}</strong>
      {lastUpdated && (
        <span
          style={{ fontSize: '0.7rem', color: '#9ca3af', marginLeft: '0.5rem' }}
          title={`Last updated: ${lastUpdated.toLocaleTimeString()}`}
        >
          ↺
        </span>
      )}
    </span>
  )
}
