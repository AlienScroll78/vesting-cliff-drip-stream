import { useState, useEffect, useCallback } from 'react'
import { Tooltip } from '../Tooltip'
import { ledgersToDuration, scheduleSchema } from './useWizard'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  update: (patch: Partial<WizardFormData>) => void
  touch: (field: string) => void
  touched: Set<string>
  onNext: () => void
  onBack: () => void
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function StepSchedule({ data, update, touch, touched, onNext, onBack }: Props) {
  const [blurred, setBlurred] = useState<Set<string>>(new Set())

  const result = scheduleSchema.safeParse({
    rate: data.rate,
    cliffDuration: data.cliffDuration,
    totalDuration: data.totalDuration,
  })

  const fieldError = (field: string): string | null => {
    if (!blurred.has(field) && !touched.has(field)) return null
    if (!result.success) {
      const err = result.error.issues.find((e) => String(e.path[0]) === field)
      return err?.message || null
    }
    return null
  }

  const rate = Number(data.rate)
  const cliff = Number(data.cliffDuration)
  const total = Number(data.totalDuration)
  const deposit = rate && total ? (rate * total).toLocaleString() : '—'

  const debouncedDeposit = useDebounce(deposit, 300)

  const canContinue = result.success

  const handleBlur = useCallback((field: string) => {
    setBlurred(prev => new Set(prev).add(field))
    touch(field)
  }, [touch])

  const fields: Array<{
    key: keyof WizardFormData
    label: string
    tooltip: string
    placeholder: string
    testId: string
    durationHint?: string
  }> = [
    {
      key: 'rate',
      label: 'Rate (tokens / ledger)',
      tooltip: 'How many tokens drip to the recipient per ledger (~5 s). Must be a positive integer.',
      placeholder: 'e.g. 10',
      testId: 'wizard-rate',
    },
    {
      key: 'cliffDuration',
      label: `Cliff duration (ledgers)${data.cliffDuration ? ` ≈ ${ledgersToDuration(Number(data.cliffDuration))}` : ''}`,
      tooltip: 'Number of ledgers before any tokens unlock. At the cliff, all accrued tokens release instantly. Must be less than total duration.',
      placeholder: 'e.g. 17280 (~1 day)',
      testId: 'wizard-cliff',
    },
    {
      key: 'totalDuration',
      label: `Total duration (ledgers)${data.totalDuration ? ` ≈ ${ledgersToDuration(Number(data.totalDuration))}` : ''}`,
      tooltip: 'Total length of the vesting stream in ledgers. Remaining tokens drip linearly after the cliff until this end point.',
      placeholder: 'e.g. 172800 (~10 days)',
      testId: 'wizard-total',
    },
  ]

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Schedule</h2>
      <p style={styles.sub}>
        Set the vesting rate, cliff period, and total duration. Values update in real time.
      </p>

      {fields.map(f => (
        <label key={f.key} style={styles.fieldLabel}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {f.label}
            <Tooltip content={f.tooltip} />
          </span>
          <input
            type="number"
            min={1}
            placeholder={f.placeholder}
            value={data[f.key]}
            onChange={e => update({ [f.key]: e.target.value })}
            onBlur={() => handleBlur(f.key)}
            aria-invalid={!!fieldError(f.key)}
            style={{
              ...styles.input,
              borderColor: fieldError(f.key) ? 'var(--color-cancelled)' : 'var(--color-border)',
            }}
            data-testid={f.testId}
          />
          {fieldError(f.key) && (
            <span role="alert" style={styles.error} data-testid={`${f.testId}-error`}>
              {fieldError(f.key)}
            </span>
          )}
        </label>
      ))}

      <p style={styles.deposit}>
        Total deposit: <strong data-testid="wizard-deposit">{debouncedDeposit}</strong>{' '}
        {data.tokenSymbol || 'tokens'}
        {data.rate && data.totalDuration && (
          <span style={{ color: '#6b7280', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
            ({Number(data.rate).toLocaleString()} / ledger × {Number(data.totalDuration).toLocaleString()} ledgers)
          </span>
        )}
      </p>

      <div style={styles.actions}>
        <button type="button" className="btn btn-ghost" onClick={onBack} data-testid="wizard-back-btn">
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canContinue}
          onClick={onNext}
          data-testid="wizard-next-btn"
        >
          Review →
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  heading: { fontSize: '1.25rem', fontWeight: 700 },
  sub: { fontSize: '0.9rem', color: '#6b7280' },
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 600 },
  input: {
    padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--color-border)', fontSize: '0.875rem',
    outline: 'none', width: '100%',
  },
  deposit: {
    fontSize: '0.875rem', padding: '0.5rem 0.75rem',
    background: '#eff6ff', borderRadius: 'var(--radius)',
  },
  error: { fontSize: '0.8rem', color: 'var(--color-cancelled)' },
  actions: { display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' },
}
