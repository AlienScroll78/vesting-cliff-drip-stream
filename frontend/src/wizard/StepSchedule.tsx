import { useState, useEffect, useCallback, type ChangeEvent } from 'react'
import { Tooltip } from '../Tooltip'
import { ledgersToDuration, scheduleSchema, isDepositOverflow, LEDGERS_PER_SECOND } from './useWizard'
import type { WizardFormData } from './useWizard'
import styles from './wizard.module.css'

interface Props {
  data: WizardFormData
  update: (patch: Partial<WizardFormData>) => void
  touch: (field: string) => void
  touched: Set<string>
  onNext: () => void
  onBack: () => void
}

/** Converts a `yyyy-mm-dd` value from `<input type="date">` into a ledger count. */
function dateToLedgers(value: string): number | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return Math.max(1, Math.round((ms - Date.now()) / 1000 / LEDGERS_PER_SECOND));
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
  // Native date field value (yyyy-mm-dd). Kept separate from the ledger count so
  // the picker keeps a valid value even when the user edits ledgers by hand.
  const [cliffDate, setCliffDate] = useState('')

  const handleCliffDateChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setCliffDate(value)
    const ledgers = dateToLedgers(value)
    if (ledgers !== null) update({ cliffDuration: String(ledgers) })
  }, [update])

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
  const overflow = data.rate && data.totalDuration ? isDepositOverflow(rate, total) : false

  const debouncedDeposit = useDebounce(deposit, 300)

  const canContinue = result.success && !overflow

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
    <div className={styles.step}>
      <h2 className={styles.stepHeading}>Schedule</h2>
      <p className={styles.stepSub}>
        Set the vesting rate, cliff period, and total duration. Values update in real time.
      </p>

      {fields.map(f => (
        <label key={f.key} className={styles.field}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {f.label}
            <Tooltip content={f.tooltip} />
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            placeholder={f.placeholder}
            value={data[f.key]}
            onChange={e => update({ [f.key]: e.target.value })}
            onBlur={() => handleBlur(f.key)}
            aria-invalid={!!fieldError(f.key)}
            className={styles.input}
            style={{
              borderColor: fieldError(f.key) ? 'var(--color-cancelled, #b91c1c)' : 'var(--color-border, #e5e7eb)',
            }}
            data-testid={f.testId}
          />
          {fieldError(f.key) && (
            <span role="alert" className={styles.error} data-testid={`${f.testId}-error`}>
              {fieldError(f.key)}
            </span>
          )}
        </label>
      ))}

      {/* Native date picker for the cliff — converts to ledgers on change (#822). */}
      <label className={styles.field}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          Cliff date
          <Tooltip content="Pick the date your cliff lands on. This is converted to a ledger count (~5 s per ledger)." />
        </span>
        <input
          type="date"
          className={styles.input}
          value={cliffDate}
          onChange={handleCliffDateChange}
          data-testid="wizard-cliff-date"
          aria-label="Cliff date"
        />
        <span className={styles.hint}>
          {cliffDate
            ? `≈ ${ledgersToDuration(dateToLedgers(cliffDate) ?? 0)} from now`
            : 'Optional — pick a date instead of counting ledgers by hand.'}
        </span>
      </label>

      <p className={styles.deposit}>
        Total deposit: <strong data-testid="wizard-deposit">{debouncedDeposit}</strong>{' '}
        {data.tokenSymbol || 'tokens'}
        {data.rate && data.totalDuration && (
          <span style={{ color: '#6b7280', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
            ({Number(data.rate).toLocaleString()} / ledger × {Number(data.totalDuration).toLocaleString()} ledgers)
          </span>
        )}
      </p>

      {overflow && (
        <div role="alert" className={styles.warning} data-testid="overflow-warning">
          ⚠️ï¸ <strong>Too large:</strong> rate × total duration is more than this contract can
          track. Reduce the rate or duration before continuing.
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={onBack}
          data-testid="wizard-back-btn"
        >
          ← Back
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
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

