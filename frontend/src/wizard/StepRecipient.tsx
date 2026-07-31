import { useState, useCallback } from 'react'
import { recipientSchema } from './useWizard'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  update: (patch: Partial<WizardFormData>) => void
  touch: (field: string) => void
  touched: Set<string>
  onNext: () => void
}

export function StepRecipient({ data, update, touch, touched, onNext }: Props) {
  const [blurred, setBlurred] = useState(false)

  const result = recipientSchema.safeParse({ recipient: data.recipient })
  const error = (blurred || touched.has('recipient')) && !result.success
    ? result.error.issues[0]?.message
    : null

  const handleChange = useCallback((val: string) => {
    update({ recipient: val })
  }, [update])

  const handleBlur = useCallback(() => {
    setBlurred(true)
    touch('recipient')
  }, [touch])

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Recipient</h2>
      <p style={styles.sub}>
        Enter the Stellar account address that will receive the streamed tokens.
      </p>

      <label style={styles.label}>
        <span>Recipient address</span>
        <input
          type="text"
          placeholder="G…"
          value={data.recipient}
          onChange={e => handleChange(e.target.value.trim())}
          onBlur={handleBlur}
          aria-invalid={!!error}
          data-testid="wizard-recipient"
          style={{
            ...styles.input,
            borderColor: error ? 'var(--color-cancelled)' : 'var(--color-border)',
          }}
          autoFocus
        />
        <span style={styles.hint}>
          Stellar addresses start with <strong>G</strong> and are 56 characters long.
        </span>
        {error && (
          <span role="alert" style={styles.error} data-testid="recipient-error">
            {error}
          </span>
        )}
      </label>

      <button
        type="button"
        className="btn btn-primary btn-full"
        disabled={!data.recipient || !!error}
        onClick={onNext}
        style={{ marginTop: '1rem' }}
        data-testid="wizard-next-btn"
      >
        Continue →
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  heading: { fontSize: '1.25rem', fontWeight: 700 },
  sub: { fontSize: '0.9rem', color: '#6b7280' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.375rem', fontSize: '0.875rem', fontWeight: 600 },
  input: {
    padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--color-border)', fontFamily: 'monospace', fontSize: '0.875rem',
    outline: 'none', width: '100%',
  },
  hint: { fontSize: '0.8rem', color: '#6b7280', fontWeight: 400 },
  error: { fontSize: '0.8rem', color: 'var(--color-cancelled)', fontWeight: 400 },
}
