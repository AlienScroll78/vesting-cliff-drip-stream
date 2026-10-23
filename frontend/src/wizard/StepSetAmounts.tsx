import { Tooltip } from '../Tooltip'
import { useTranslation } from 'react-i18next'
import { ledgersToDuration } from './useWizard'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  update: (patch: Partial<WizardFormData>) => void
  onNext: () => void
  onBack: () => void
}

function fieldError(data: WizardFormData, t: (key: string) => string): string | null {
  const rate = Number(data.rate)
  const cliff = Number(data.cliffDuration)
  const total = Number(data.totalDuration)
  if (data.rate && rate <= 0) return t('wizard.invalidRate')
  if (data.cliffDuration && data.totalDuration && cliff >= total)
    return t('wizard.invalidCliff')
  if (data.totalDuration && total <= 0) return t('wizard.invalidTotal')
  return null
}

function totalDeposit(data: WizardFormData): string {
  const rate = Number(data.rate)
  const total = Number(data.totalDuration)
  if (!rate || !total) return '—'
  return (rate * total).toLocaleString()
}

export function StepSetAmounts({ data, update, onNext, onBack }: Props) {
  const { t } = useTranslation()
  const error = fieldError(data, t)
  const canContinue =
    !!data.rate && !!data.cliffDuration && !!data.totalDuration && !!data.recipient && !error

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>{t('wizard.setAmounts')}</h2>

      <Field
        label={t('home.recipientAddress')}
        tooltip={t('wizard.recipientHelp')}
        testId="wizard-recipient"
      >
        <input
          type="text"
          placeholder="G…"
          value={data.recipient}
          onChange={e => update({ recipient: e.target.value.trim() })}
          style={styles.input}
        />
      </Field>

      <Field
        label={t('rate')}
        tooltip={t('wizard.rateHelp')}
        testId="wizard-rate"
      >
        <input
          type="number"
          min={1}
          placeholder="e.g. 10"
          value={data.rate}
          onChange={e => update({ rate: e.target.value })}
          style={styles.input}
        />
      </Field>

      <Field
        label={`${t('cliffDuration')}${data.cliffDuration ? ` ≈ ${ledgersToDuration(Number(data.cliffDuration), t)}` : ''}`}
        tooltip={t('wizard.cliffHelp')}
        testId="wizard-cliff"
      >
        <input
          type="number"
          min={1}
          placeholder="e.g. 17280  (~1 day)"
          value={data.cliffDuration}
          onChange={e => update({ cliffDuration: e.target.value })}
          style={styles.input}
        />
      </Field>

      <Field
        label={`${t('totalDuration')}${data.totalDuration ? ` ≈ ${ledgersToDuration(Number(data.totalDuration), t)}` : ''}`}
        tooltip={t('wizard.totalHelp')}
        testId="wizard-total"
      >
        <input
          type="number"
          min={1}
          placeholder="e.g. 172800  (~10 days)"
          value={data.totalDuration}
          onChange={e => update({ totalDuration: e.target.value })}
          style={styles.input}
        />
      </Field>

      <p style={styles.deposit}>
        {t('wizard.totalDeposit')}: <strong data-testid="wizard-deposit">{totalDeposit(data)}</strong>{' '}
        {data.tokenSymbol || 'tokens'}
      </p>

      {error && <p role="alert" style={styles.error}>{error}</p>}

      <div style={styles.actions}>
        <button type="button" className="btn btn-ghost" onClick={onBack} data-testid="wizard-back-btn">
          ← {t('history.back')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canContinue}
          onClick={onNext}
          data-testid="wizard-next-btn"
        >
          {t('wizard.preview')} →
        </button>
      </div>
    </div>
  )
}

function Field({
  label, tooltip, testId, children,
}: {
  label: string; tooltip: string; testId: string; children: React.ReactNode
}) {
  return (
    <label style={styles.fieldLabel}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {label}
        <Tooltip content={tooltip} />
      </span>
      <div data-testid={testId}>{children}</div>
    </label>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  heading: { fontSize: '1.25rem', fontWeight: 700 },
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.875rem', fontWeight: 600 },
  input: {
    padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--color-border)', fontSize: '0.875rem',
    outline: 'none', width: '100%',
  },
  deposit: { fontSize: '0.875rem', padding: '0.5rem 0.75rem', background: '#eff6ff', borderRadius: 'var(--radius)' },
  error: { color: 'var(--color-cancelled)', fontSize: '0.875rem' },
  actions: { display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' },
}
