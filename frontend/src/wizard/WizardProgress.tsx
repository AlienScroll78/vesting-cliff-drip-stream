import type { WizardStep } from './useWizard'

const LABELS: Record<WizardStep, string> = {
  'connect-wallet': 'Connect',
  'select-token':   'Token',
  'set-amounts':    'Amounts',
  'preview':        'Preview',
  'confirm':        'Confirm',
}

interface WizardProgressProps {
  steps: readonly WizardStep[]
  current: number
}

export function WizardProgress({ steps, current }: WizardProgressProps) {
  return (
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
  )
}

const styles = {
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    padding: '1rem 0 1.5rem',
  } as React.CSSProperties,
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
  } as React.CSSProperties,
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
  } as React.CSSProperties,
  label: {
    fontSize: '0.75rem',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  line: {
    width: '2rem',
    height: '2px',
    flexShrink: 0,
    marginLeft: '0.375rem',
    transition: 'background 0.2s',
  } as React.CSSProperties,
}
