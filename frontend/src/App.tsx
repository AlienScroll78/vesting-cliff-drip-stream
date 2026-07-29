import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'

// #123 — field tooltips
import { Tooltip } from './Tooltip'
// #122 — error message map
import { getErrorInfo } from './errorMessages'
// #121 — Framer Motion animations
import { PageTransition, AnimatedBalance, AnimatedProgressBar } from './animations'
// #120 — onboarding tour
import { useOnboardingTour } from './useOnboardingTour'
// #125 — create stream wizard
import { CreateStreamWizard } from './wizard/CreateStreamWizard'

function App() {
  const [count, setCount] = useState(0)
  const [wizardOpen, setWizardOpen] = useState(false)
  // demo: simulate an error code returned from the contract
  const [errorCode, setErrorCode] = useState<number | null>(null)

  // #120 — start tour for first-time users
  useOnboardingTour()

  const errorInfo = errorCode != null ? getErrorInfo(errorCode) : null

  return (
    // #121 — page fade-in on mount
    <PageTransition>
      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>

        <div>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
          </p>
        </div>

        {/* #121 — animated claimable balance */}
        <p style={{ marginTop: '12px', color: 'var(--text)' }}>
          Claimable balance:{' '}
          <strong>
            <AnimatedBalance value={count * 100} />
          </strong>{' '}
          tokens
        </p>

        {/* #121 — animated progress bar */}
        <div style={{ margin: '12px auto', maxWidth: 300 }}>
          <AnimatedProgressBar pct={Math.min(count * 10, 100)} />
        </div>

        <button
          type="button"
          className="counter"
          onClick={() => setCount((c) => c + 1)}
          data-tour="claim"
        >
          Count is {count}
        </button>

        {/* #123 — fields with tooltips */}
        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Rate (tokens / ledger)
            <Tooltip content="How many tokens drip to the recipient per ledger (~5 s). Must be a positive integer. Higher rates deplete the deposit faster." />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} data-tour="cliff">
            Cliff duration (ledgers)
            <Tooltip content="Number of ledgers before any tokens unlock. At the cliff, all accrued tokens release at once. Must be less than total duration." />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Total duration (ledgers)
            <Tooltip content="Total length of the vesting stream in ledgers. Remaining tokens drip linearly after the cliff until this end point." />
          </label>
        </div>

        {/* #122 — demo error message display */}
        <div style={{ marginTop: '20px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {[1, 2, 6, 7].map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setErrorCode(errorCode === code ? null : code)}
              style={{
                background: 'var(--accent-bg)',
                border: '1px solid var(--accent-border)',
                borderRadius: '4px',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '4px 8px',
              }}
            >
              Error {code}
            </button>
          ))}
        </div>

        {errorInfo && (
          <div
            role="alert"
            style={{
              margin: '16px auto',
              maxWidth: 360,
              padding: '12px 16px',
              background: 'var(--accent-bg)',
              border: '1px solid var(--accent-border)',
              borderRadius: '8px',
              textAlign: 'left',
            }}
          >
            <strong style={{ color: 'var(--accent)' }}>{errorInfo.title}</strong>
            <p style={{ fontSize: '14px', margin: '4px 0' }}>{errorInfo.explanation}</p>
            <p style={{ fontSize: '13px', color: 'var(--text)' }}>
              💡 {errorInfo.action}
              {errorInfo.faqUrl && (
                <>
                  {' '}
                  <a href={errorInfo.faqUrl} style={{ color: 'var(--accent)' }}>Learn more</a>
                </>
              )}
            </p>
          </div>
        )}

        {/* tour anchor for wallet */}
        <div data-tour="wallet" style={{ marginTop: '8px', opacity: 0, height: 1 }} aria-hidden="true" />
        {/* tour anchor for create stream */}
        <div data-tour="create-stream" style={{ opacity: 0, height: 1 }} aria-hidden="true" />

        {/* #125 — create stream wizard trigger */}
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: '1rem' }}
          onClick={() => setWizardOpen(true)}
          data-testid="open-create-wizard"
        >
          Create Stream
        </button>

        {wizardOpen && <CreateStreamWizard onClose={() => setWizardOpen(false)} />}
      </section>

      <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank">
                <img className="button-icon" src={reactLogo} alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Connect with us</h2>
          <p>Join the Vite community</p>
          <ul>
            <li>
              <a href="https://github.com/vitejs/vite" target="_blank">
                <svg className="button-icon" role="presentation" aria-hidden="true">
                  <use href="/icons.svg#github-icon"></use>
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a href="https://chat.vite.dev/" target="_blank">
                <svg className="button-icon" role="presentation" aria-hidden="true">
                  <use href="/icons.svg#discord-icon"></use>
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a href="https://x.com/vite_js" target="_blank">
                <svg className="button-icon" role="presentation" aria-hidden="true">
                  <use href="/icons.svg#x-icon"></use>
                </svg>
                X.com
              </a>
            </li>
            <li>
              <a href="https://bsky.app/profile/vite.dev" target="_blank">
                <svg className="button-icon" role="presentation" aria-hidden="true">
                  <use href="/icons.svg#bluesky-icon"></use>
                </svg>
                Bluesky
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </PageTransition>
  )
}

export default App
