import type { WizardStep } from './useWizard'

const LABELS: Record<WizardStep, string> = {
  recipient: 'Recipient',
  token: 'Token',
  schedule: 'Schedule',
  review: 'Review',
}

interface WizardProgressProps {
  steps: readonly WizardStep[]
  current: number
}

export function WizardProgress({ steps, current }: WizardProgressProps) {
  return (
    <div style={styles.container}>
      <nav aria-label="Wizard progress" style={styles.nav}>
        {steps.map((s, i) => {
          const done = i < current
          const active = i === current
          return (
            <div key={s} style={styles.item}>
              <div
                aria-current={active ? 'step' : undefined}
                style={{
                  ...styles.circle,
                  background: done || active ? 'var(--color-active)' : 'var(--color-border)',
                  color: done || active ? '#fff' : 'var(--color-text)',
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                style={{
                  ...styles.label,
                  fontWeight: active ? 700 : 400,
                  color: active ? 'var(--color-active)' : 'var(--color-text)',
                }}
              >
                {LABELS[s]}
              </span>
              {i < steps.length - 1 && (
                <div
                  aria-hidden="true"
                  style={{
                    ...styles.line,
                    background: done ? 'var(--color-active)' : 'var(--color-border)',
                  }}
                />
              )}
            </div>
          )
        })}
      </nav>
      <span style={styles.counter}>
        Step {current + 1} of {steps.length}
      </span>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    padding: '1rem 0 0',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
  },
  circle: {
    width: '2rem',
    height: '2rem',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8rem',
    fontWeight: 700,
    flexShrink: 0,
    transition: 'background 0.2s',
  },
  label: {
    fontSize: '0.75rem',
    whiteSpace: 'nowrap' as const,
  },
  line: {
    width: '2rem',
    height: '2px',
    flexShrink: 0,
    marginLeft: '0.375rem',
    transition: 'background 0.2s',
  },
  counter: {
    fontSize: '0.75rem',
    color: '#6b7280',
  },
}
