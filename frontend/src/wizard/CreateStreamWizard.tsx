import { useWizard, WIZARD_STEPS } from './useWizard'
import { WizardProgress } from './WizardProgress'
import { StepRecipient } from './StepRecipient'
import { StepSelectToken } from './StepSelectToken'
import { StepSchedule } from './StepSchedule'
import { StepReview } from './StepReview'

interface Props {
  onClose?: () => void
}

export function CreateStreamWizard({ onClose }: Props) {
  const {
    step, stepIndex, data, touched,
    next, back, update, touch, reset,
  } = useWizard()

  function handleDone() {
    reset()
    onClose?.()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create vesting stream"
      data-testid="create-stream-wizard"
      style={styles.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div style={styles.panel}>
        <div style={styles.header}>
          <h1 style={styles.title}>Create stream</h1>
          {onClose && (
            <button
              type="button"
              aria-label="Close wizard"
              onClick={onClose}
              style={styles.close}
            >
              ✕
            </button>
          )}
        </div>

        <WizardProgress steps={WIZARD_STEPS} current={stepIndex} />

        <div style={styles.body}>
          {step === 'recipient' && (
            <StepRecipient
              data={data}
              update={update}
              touch={touch}
              touched={touched}
              onNext={next}
            />
          )}
          {step === 'token' && (
            <StepSelectToken
              data={data}
              update={update}
              touch={touch}
              touched={touched}
              onNext={next}
              onBack={back}
            />
          )}
          {step === 'schedule' && (
            <StepSchedule
              data={data}
              update={update}
              touch={touch}
              touched={touched}
              onNext={next}
              onBack={back}
            />
          )}
          {step === 'review' && (
            <StepReview
              data={data}
              onNext={next}
              onBack={back}
              onDone={handleDone}
            />
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200,
    padding: '1rem',
  },
  panel: {
    background: 'var(--color-surface)',
    borderRadius: '0.75rem',
    boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
    width: '100%',
    maxWidth: '520px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '1.25rem 1.5rem 0',
  },
  title: { fontSize: '1rem', fontWeight: 700 },
  close: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '1rem', color: '#6b7280', padding: '0.25rem',
  },
  body: { padding: '0 1.5rem 1.5rem' },
}
