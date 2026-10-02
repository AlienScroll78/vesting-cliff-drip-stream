import { useState, useCallback } from 'react'
import { recipientSchema } from './useWizard'
import type { WizardFormData } from './useWizard'
import styles from './wizard.module.css'

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
    <div className={styles.step}>
      <h2 className={styles.stepHeading}>Recipient</h2>
      <p className={styles.stepSub}>
        Enter the Stellar account address that will receive the streamed tokens.
      </p>

      <label className={styles.field}>
        <span>Recipient address</span>
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="G…"
          value={data.recipient}
          onChange={e => handleChange(e.target.value.trim())}
          onBlur={handleBlur}
          aria-invalid={!!error}
          data-testid="wizard-recipient"
          className={styles.input}
          style={{
            borderColor: error ? 'var(--color-cancelled, #b91c1c)' : 'var(--color-border, #e5e7eb)',
          }}
          autoFocus
        />
        <span className={styles.hint}>
          Stellar addresses start with <strong>G</strong> and are 56 characters long.
        </span>
        {error && (
          <span role="alert" className={styles.error} data-testid="recipient-error">
            {error}
          </span>
        )}
      </label>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!data.recipient || !!error}
          onClick={onNext}
          data-testid="wizard-next-btn"
        >
          Continue →
        </button>
      </div>
    </div>
  )
}

