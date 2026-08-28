import { useState } from 'react'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  update: (patch: Partial<WizardFormData>) => void
  onNext: () => void
  onBack: () => void
}

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/

function validate(address: string): string | null {
  if (!address) return 'Recipient address is required.'
  if (!STELLAR_ADDRESS_RE.test(address))
    return 'Must be a valid Stellar address starting with G (56 characters).'
  return null
}

export function StepSelectRecipient({ data, update, onNext, onBack }: Props) {
  const [touched, setTouched] = useState(false)
  const error = validate(data.recipient)
  const showError = touched && !!error

  function handleChange(val: string) {
    update({ recipient: val.trim() })
  }

  function handleNext() {
    setTouched(true)
    if (!error) onNext()
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Recipient address</h2>
      <p style={styles.sub}>
        Enter the Stellar account that will receive the streamed tokens.
      </p>

      <label style={styles.label} htmlFor="wizard-recipient-input">
        Recipient (G…)
      </label>
      <input
        id="wizard-recipient-input"
        type="text"
        placeholder="GABC…"
        value={data.recipient}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={showError}
        aria-describedby={showError ? 'wizard-recipient-error' : undefined}
        style={{
          ...styles.input,
          borderColor: showError ? 'var(--color-cancelled)' : 'var(--color-border)',
        }}
        data-testid="wizard-recipient"
        autoFocus
      />

      {showError && (
        <span
          id="wizard-recipient-error"
          role="alert"
          data-testid="wizard-recipient-error"
          style={styles.error}
        >
          {error}
        </span>
      )}

      {/* Live green tick when valid */}
      {!error && data.recipient && (
        <div style={styles.valid}>
          <span style={{ color: 'var(--color-completed)' }}>✓</span>
          <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}>
            {data.recipient}
          </span>
        </div>
      )}

      <div style={styles.actions}>
        <button type="button" className="btn btn-ghost" onClick={onBack} data-testid="wizard-back-btn">
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleNext}
          data-testid="wizard-next-btn"
        >
          Continue →
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  heading: { fontSize: '1.25rem', fontWeight: 700 },
  sub: { fontSize: '0.9rem', color: '#6b7280' },
  label: { fontSize: '0.875rem', fontWeight: 600 },
  input: {
    padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--color-border)', fontFamily: 'monospace', fontSize: '0.875rem',
    outline: 'none', width: '100%',
  },
  error: { fontSize: '0.8rem', color: 'var(--color-cancelled)' },
  valid: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.5rem 0.75rem', background: '#f0fdf4',
    borderRadius: 'var(--radius)', border: '1px solid #86efac',
  },
  actions: { display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' },
}
