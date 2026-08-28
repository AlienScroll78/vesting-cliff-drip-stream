import { ledgersToDuration, isDepositOverflow } from './useWizard'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  onNext: () => void
  onBack: () => void
}

export function StepPreview({ data, onNext, onBack }: Props) {
  const cliff = Number(data.cliffDuration)
  const total = Number(data.totalDuration)
  const rate  = Number(data.rate)
  const overflow = isDepositOverflow(rate, total)
  const deposit = overflow ? null : rate * total

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Preview stream</h2>
      <p style={styles.sub}>Review all values before signing. Nothing is sent until you confirm.</p>

      <dl style={styles.dl}>
        <Row label="Sponsor (you)" value={data.walletAddress} mono />
        <Row label="Recipient"     value={data.recipient}     mono />
        <Row label="Token"         value={`${data.tokenSymbol} (${data.tokenAddress.slice(0, 8)}…)`} />
        <Row label="Rate"          value={`${rate.toLocaleString()} tokens / ledger`} />
        <Row
          label="Cliff"
          value={`${cliff.toLocaleString()} ledgers ≈ ${ledgersToDuration(cliff)}`}
        />
        <Row
          label="Total duration"
          value={`${total.toLocaleString()} ledgers ≈ ${ledgersToDuration(total)}`}
        />
        {deposit !== null ? (
          <Row
            label="Total deposit"
            value={`${deposit.toLocaleString()} ${data.tokenSymbol || 'tokens'}`}
            highlight
          />
        ) : (
          <Row label="Total deposit" value="⚠️ Overflow — reduce rate or duration" highlight />
        )}
      </dl>

      {/* Overflow banner */}
      {overflow && (
        <div
          role="alert"
          data-testid="preview-overflow-warning"
          style={{
            padding: '0.75rem', background: '#fef2f2',
            border: '1px solid var(--color-cancelled)', borderRadius: 'var(--radius)',
            fontSize: '0.85rem', color: 'var(--color-cancelled)',
          }}
        >
          <strong>⚠️ Deposit overflow</strong> — rate × total_duration exceeds i128::MAX.
          Go back and reduce the rate or total duration.
        </div>
      )}

      {/* Normal deposit warning */}
      {!overflow && deposit !== null && (
        <div
          style={{
            padding: '0.75rem', background: '#fffbeb',
            border: '1px solid #fde68a', borderRadius: 'var(--radius)', fontSize: '0.85rem',
          }}
        >
          ⚠️ The full deposit of{' '}
          <strong>{deposit.toLocaleString()} {data.tokenSymbol || 'tokens'}</strong> will be
          transferred from your wallet on confirmation.
        </div>
      )}

      <div style={styles.actions}>
        <button type="button" className="btn btn-ghost" onClick={onBack} data-testid="wizard-back-btn">
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={overflow}
          onClick={onNext}
          data-testid="wizard-next-btn"
        >
          Confirm &amp; Sign →
        </button>
      </div>
    </div>
  )
}

function Row({
  label, value, mono, highlight,
}: {
  label: string; value: string; mono?: boolean; highlight?: boolean
}) {
  return (
    <>
      <dt style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>{label}</dt>
      <dd
        data-testid={`preview-${label.toLowerCase().replace(/\s+/g, '-')}`}
        style={{
          fontSize: '0.9rem',
          fontFamily: mono ? 'monospace' : undefined,
          fontWeight: highlight ? 700 : 400,
          color: highlight ? 'var(--color-active)' : undefined,
          wordBreak: 'break-all',
          marginBottom: '0.5rem',
        }}
      >
        {value}
      </dd>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  heading: { fontSize: '1.25rem', fontWeight: 700 },
  sub: { fontSize: '0.9rem', color: '#6b7280' },
  dl: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0 1rem' },
  actions: { display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' },
}
