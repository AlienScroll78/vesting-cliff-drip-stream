import type { WizardStep } from './useWizard'
import styles from './wizard.module.css'

const LABELS: Record<WizardStep, string> = {
  recipient: 'Recipient',
  token: 'Token',
  schedule: 'Schedule',
  review: 'Review',
}

interface WizardProgressProps {
  steps: readonly WizardStep[]
  current: number
  /** Longest step the user has reached — drives which circles show a checkmark. */
  furthest?: number
  /** Jump to a step. Only steps up to `furthest` are reachable. */
  onGoToStep?: (index: number) => void
}

/**
 * Numbered step indicator (#822).
 *
 * Renders "Step N of M", a checkmark on every completed step, and makes each
 * circle a 44px tap target so a user can jump back to a step they already
 * finished without losing their answers.
 */
export function WizardProgress({ steps, current, furthest, onGoToStep }: WizardProgressProps) {
  const done = furthest ?? current

  return (
    <div className={styles.progress}>
      <nav aria-label="Wizard progress" className={styles.progressNav}>
        {steps.map((s, i) => {
          const complete = i < done
          const active = i === current
          // Only allow jumping backwards — forwards navigation is gated by
          // each step's own validation.
          const reachable = onGoToStep && (complete || active)
          return (
            <div key={s} className={styles.progressItem}>
              {reachable ? (
                <button
                  type="button"
                  onClick={() => onGoToStep(i)}
                  aria-current={active ? 'step' : undefined}
                  aria-label={`Step ${i + 1}: ${LABELS[s]}${complete ? ' (completed)' : ''}`}
                  data-testid={`wizard-step-${i}`}
                  className={[
                    styles.progressCircle,
                    complete ? styles.progressCircleDone : '',
                    active ? styles.progressCircleActive : '',
                  ].filter(Boolean).join(' ')}
                >
                  {complete ? '✓' : i + 1}
                </button>
              ) : (
                <span
                  aria-hidden="true"
                  className={[
                    styles.progressCircle,
                    complete ? styles.progressCircleDone : '',
                    active ? styles.progressCircleActive : '',
                  ].filter(Boolean).join(' ')}
                >
                  {complete ? '✓' : i + 1}
                </span>
              )}
              <span
                className={[
                  styles.progressLabel,
                  active ? styles.progressLabelActive : '',
                ].filter(Boolean).join(' ')}
                aria-hidden="true"
              >
                {LABELS[s]}
              </span>
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={[
                    styles.progressLine,
                    complete ? styles.progressLineDone : '',
                  ].filter(Boolean).join(' ')}
                />
              )}
            </div>
          )
        })}
      </nav>
      <span className={styles.progressCounter} data-testid="wizard-step-counter">
        Step {current + 1} of {steps.length}
      </span>
    </div>
  )
}
