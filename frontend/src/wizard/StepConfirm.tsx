import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  onBack: () => void
  onDone: () => void
}

type State = 'idle' | 'submitting' | 'success' | 'error'

export function StepConfirm({ data, onBack, onDone }: Props) {
  const { t } = useTranslation()
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function submit() {
    setState('submitting')
    try {
      // TODO: call create_vesting_stream via @stellar/freighter-api / soroban-client
      // Simulated delay for demo
      await new Promise(r => setTimeout(r, 1200))
      setState('success')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t('txFailed'))
      setState('error')
    }
  }

  if (state === 'success') {
    return (
      <div style={{ ...styles.card, alignItems: 'center', textAlign: 'center' }}>
        <div style={styles.successIcon}>✓</div>
        <h2 style={styles.heading}>{t('wizard.streamCreated')}</h2>
        <p style={styles.sub}>
          {t('wizard.streamCreatedDescription')}
        </p>
        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={onDone}
          data-testid="wizard-done-btn"
        >
          {t('wizard.done')}
        </button>
      </div>
    )
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>{t('wizard.confirmSign')}</h2>
      <p style={styles.sub}>
        {t('wizard.signDescription')}
      </p>

      <p style={styles.warn}>
        {t('wizard.depositWarning')}
      </p>

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
          ← {t('history.back')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={state === 'submitting'}
          onClick={submit}
          data-testid="wizard-submit-btn"
        >
          {state === 'submitting' ? t('wizard.signing') : t('wizard.signSubmit')}
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  heading: { fontSize: '1.25rem', fontWeight: 700 },
  sub: { fontSize: '0.9rem', color: '#6b7280' },
  warn: {
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
