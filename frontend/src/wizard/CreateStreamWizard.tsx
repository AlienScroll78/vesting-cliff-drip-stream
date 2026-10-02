import { useWizard, WIZARD_STEPS } from './useWizard'
import { WizardProgress } from './WizardProgress'
import { StepRecipient } from './StepRecipient'
import { StepSelectToken } from './StepSelectToken'
import { StepSchedule } from './StepSchedule'
import { StepReview } from './StepReview'
import styles from './wizard.module.css'

interface Props {
  onClose?: () => void
}

export function CreateStreamWizard({ onClose }: Props) {
  const {
    step, stepIndex, data, touched, furthestStep,
    next, back, update, touch, reset, goToStep,
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
      className={styles.overlay}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className={styles.panel} role="document">
        <div className={styles.header}>
          <h1 className={styles.title}>Create stream</h1>
          {onClose && (
            <button
              type="button"
              aria-label="Close wizard"
              onClick={onClose}
              className={styles.close}
            >
              <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>

        <WizardProgress
          steps={WIZARD_STEPS}
          current={stepIndex}
          furthest={furthestStep}
          onGoToStep={goToStep}
        />

        <div className={styles.body}>
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
