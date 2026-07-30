import { useState, useMemo } from 'react'
import { ledgersToDuration } from './useWizard'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  onNext: () => void
  onBack: () => void
  onDone: () => void
}

type State = 'idle' | 'submitting' | 'success' | 'error'

export function StepReview({ data, onNext, onBack, onDone }: Props) {
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const cliff = Number(data.cliffDuration)
  const total = Number(data.totalDuration)
  const rate = Number(data.rate)
  const deposit = rate * total

  const costBreakdown = useMemo(() => {
    const cliffTokens = rate * cliff
    const linearTokens = rate * (total - cliff)
    return { cliffTokens, linearTokens, totalDeposit: deposit }
  }, [rate, cliff, total, deposit])

  async function submit() {
    setState('submitting')
    try {
      await new Promise(r => setTimeout(r, 1200))
      setState('success')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed')
      setState('error')
    }
  }

  if (state === 'success') {
    return (
      <div style={{ ...styles.card, alignItems: 'center', textAlign: 'center' }}>
        <div style={styles.successIcon}>✓</div>
        <h2 style={styles.heading}>Stream created!</h2>
        <p style={styles.sub}>
          Tokens are now locked. The recipient can claim after the cliff.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={onDone}
          data-testid="wizard-done-btn"
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Review stream</h2>
      <p style={styles.sub}>Review all values before signing. Nothing is sent until you confirm.</p>

      <dl style={styles.dl}>
        <Row label="Recipient" value={data.recipient} mono />
        <Row label="Token" value={`${data.tokenSymbol} (${data.tokenAddress.slice(0, 8)}…)`} />
        <Row label="Rate" value={`${rate.toLocaleString()} tokens / ledger`} />
        <Row
          label="Cliff"
          value={`${cliff.toLocaleString()} ledgers ≈ ${ledgersToDuration(cliff)}`}
        />
        <Row
          label="Total duration"
          value={`${total.toLocaleString()} ledgers ≈ ${ledgersToDuration(total)}`}
        />
      </dl>

      <div style={styles.costBreakdown}>
        <h3 style={styles.costTitle}>Cost breakdown</h3>
        <div style={styles.costRow}>
          <span>Cliff release</span>
          <span>{costBreakdown.cliffTokens.toLocaleString()} {data.tokenSymbol}</span>
        </div>
        <div style={styles.costRow}>
          <span>Linear streaming</span>
          <span>{costBreakdown.linearTokens.toLocaleString()} {data.tokenSymbol}</span>
        </div>
        <div style={{ ...styles.costRow, fontWeight: 700, borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
          <span>Total deposit</span>
          <span data-testid="preview-total-deposit">{costBreakdown.totalDeposit.toLocaleString()} {data.tokenSymbol}</span>
        </div>
      </div>

      <div style={styles.warningBox}>
        ⚠️ The full deposit of <strong>{deposit.toLocaleString()} {data.tokenSymbol || 'tokens'}</strong> will be
        transferred from your wallet on confirmation. Once submitted you cannot undo the deposit.
      </div>

      {state === 'error' && (
        <p role="alert" style={styles.error}>
          {errorMsg}
        </p>
      )}

      <div style={styles.actions}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onBack}
          disabled={state === 'submitting'}
          data-testid="wizard-back-btn"
        >
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={state === 'submitting'}
          onClick={submit}
          data-testid="wizard-submit-btn"
        >
          {state === 'submitting' ? 'Signing…' : 'Confirm & Sign'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>{label}</dt>
      <dd
        data-testid={`preview-${label.toLowerCase().replace(/\s+/g, '-')}`}
        style={{
          fontSize: '0.9rem',
          fontFamily: mono ? 'monospace' : undefined,
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
  costBreakdown: {
    padding: '0.75rem',
    background: '#f8fafc',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--color-border)',
  },
  costTitle: { fontSize: '0.85rem', fontWeight: 700, margin: '0 0 0.5rem' },
  costRow: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: '0.85rem', padding: '0.15rem 0',
  },
  warningBox: {
    padding: '0.75rem', background: '#fffbeb',
    border: '1px solid #fde68a', borderRadius: 'var(--radius)', fontSize: '0.85rem',
  },
  error: { color: 'var(--color-cancelled)', fontSize: '0.875rem' },
  actions: { display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' },
  successIcon: {
    width: '3.5rem', height: '3.5rem', borderRadius: '50%',
    background: 'var(--color-completed)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '1.75rem', fontWeight: 700,
  },
}
