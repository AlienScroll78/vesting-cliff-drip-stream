import { Tooltip } from '../Tooltip'
import { ledgersToDuration, isDepositOverflow } from './useWizard'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  update: (patch: Partial<WizardFormData>) => void
  onNext: () => void
  onBack: () => void
}

function fieldErrors(data: WizardFormData): Record<string, string> {
  const errs: Record<string, string> = {}
  const rate = Number(data.rate)
  const cliff = Number(data.cliffDuration)
  const total = Number(data.totalDuration)

  if (data.rate && (!Number.isInteger(rate) || rate <= 0))
    errs.rate = 'Rate must be a positive integer (> 0).'

  if (data.cliffDuration && (isNaN(cliff) || cliff <= 0))
    errs.cliffDuration = 'Cliff duration must be a positive number of ledgers.'

  if (data.totalDuration) {
    if (isNaN(total) || total <= 0) {
      errs.totalDuration = 'Total duration must be positive.'
    } else if (data.cliffDuration && total <= cliff) {
      errs.totalDuration = 'Total duration must be greater than cliff duration.'
    }
  }

  return errs
}

function computeDeposit(data: WizardFormData): { value: number | null; overflow: boolean } {
  const rate = Number(data.rate)
  const total = Number(data.totalDuration)
  if (!rate || !total) return { value: null, overflow: false }
  if (isDepositOverflow(rate, total)) return { value: null, overflow: true }
  return { value: rate * total, overflow: false }
}

export function StepSetAmounts({ data, update, onNext, onBack }: Props) {
  const errors = fieldErrors(data)
  const deposit = computeDeposit(data)
  const hasError = Object.keys(errors).length > 0 || deposit.overflow

  const canContinue =
    !!data.rate &&
    !!data.cliffDuration &&
    !!data.totalDuration &&
    !hasError

  const cliffLedgers = Number(data.cliffDuration)
  const totalLedgers = Number(data.totalDuration)

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Set amounts &amp; durations</h2>

      <Field
        label="Rate (tokens / ledger)"
        tooltip="How many tokens drip to the recipient per ledger (~5 s). Must be a positive integer."
        testId="wizard-rate"
        error={errors.rate}
      >
        <input
          type="number"
          min={1}
          step={1}
          placeholder="e.g. 10"
          value={data.rate}
          onChange={e => update({ rate: e.target.value })}
          style={inputStyle(!!errors.rate)}
          aria-invalid={!!errors.rate}
          aria-describedby={errors.rate ? 'wizard-rate-error' : undefined}
        />
      </Field>

      <Field
        label={`Cliff duration (ledgers)${cliffLedgers > 0 ? ` — ≈ ${ledgersToDuration(cliffLedgers)}` : ''}`}
        tooltip="Number of ledgers before any tokens unlock. At the cliff, all accrued tokens release instantly. Must be less than total duration."
        testId="wizard-cliff"
        error={errors.cliffDuration}
      >
        <input
          type="number"
          min={1}
          placeholder="e.g. 17280  (~1 day)"
          value={data.cliffDuration}
          onChange={e => update({ cliffDuration: e.target.value })}
          style={inputStyle(!!errors.cliffDuration)}
          aria-invalid={!!errors.cliffDuration}
          aria-describedby={errors.cliffDuration ? 'wizard-cliff-error' : undefined}
        />
      </Field>

      <Field
        label={`Total duration (ledgers)${totalLedgers > 0 ? ` — ≈ ${ledgersToDuration(totalLedgers)}` : ''}`}
        tooltip="Total length of the vesting stream in ledgers. Remaining tokens drip linearly after the cliff until this end point."
        testId="wizard-total"
        error={errors.totalDuration}
      >
        <input
          type="number"
          min={1}
          placeholder="e.g. 172800  (~10 days)"
          value={data.totalDuration}
          onChange={e => update({ totalDuration: e.target.value })}
          style={inputStyle(!!errors.totalDuration)}
          aria-invalid={!!errors.totalDuration}
          aria-describedby={errors.totalDuration ? 'wizard-total-error' : undefined}
        />
      </Field>

      {/* ── Live deposit preview ── */}
      {deposit.value !== null && (
        <div
          role="status"
          aria-live="polite"
          data-testid="wizard-deposit-preview"
          style={styles.depositPreview}
        >
          <span style={{ fontWeight: 600 }}>Total deposit:</span>{' '}
          <strong data-testid="wizard-deposit">
            {deposit.value.toLocaleString()}
          </strong>{' '}
          {data.tokenSymbol || 'tokens'}
          <span style={{ fontSize: '0.8rem', color: '#6b7280', marginLeft: '0.4rem' }}>
            ({data.rate} tokens/ledger × {data.totalDuration} ledgers)
          </span>
        </div>
      )}

      {/* ── Overflow warning ── */}
      {deposit.overflow && (
        <div
          role="alert"
          data-testid="wizard-overflow-warning"
          style={styles.overflowWarning}
        >
          <strong>⚠️ Deposit overflow!</strong>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
            rate × total_duration exceeds the maximum i128 value (
            170,141,183,460,469,231,731,687,303,715,884,105,727). Reduce the rate or duration.
          </p>
        </div>
      )}

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
          Preview →
        </button>
      </div>
    </div>
  )
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    padding: '0.5rem 0.75rem',
    borderRadius: 'var(--radius)',
    border: `1px solid ${hasError ? 'var(--color-cancelled)' : 'var(--color-border)'}`,
    fontSize: '0.875rem',
    outline: 'none',
    width: '100%',
  }
}

function Field({
  label, tooltip, testId, error, children,
}: {
  label: string
  tooltip: string
  testId: string
  error?: string
  children: React.ReactNode
}) {
  const errorId = `${testId}-error`
  return (
    <label style={styles.fieldLabel}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {label}
        <Tooltip content={tooltip} />
      </span>
      <div data-testid={testId}>{children}</div>
      {error && (
        <span id={errorId} role="alert" style={styles.fieldError} data-testid={`${testId}-error`}>
          {error}
        </span>
      )}
    </label>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  heading: { fontSize: '1.25rem', fontWeight: 700 },
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 600 },
  fieldError: { fontSize: '0.8rem', color: 'var(--color-cancelled)' },
  depositPreview: {
    padding: '0.75rem 1rem',
    background: '#eff6ff',
    border: '1px solid var(--color-active)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
  },
  overflowWarning: {
    padding: '0.75rem 1rem',
    background: '#fef2f2',
    border: '1px solid var(--color-cancelled)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
    color: 'var(--color-cancelled)',
  },
  actions: { display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' },
}
