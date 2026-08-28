import { useState } from 'react'
import { useWallet } from '../contexts/WalletContext'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  onBack: () => void
  onDone: () => void
}

type State = 'idle' | 'submitting' | 'success' | 'error'

// ── Stub: replace with real Soroban contract invocation ────────────────────────
async function submitCreateStream(params: {
  sponsor: string
  recipient: string
  token: string
  rate: number
  cliffDuration: number
  totalDuration: number
}): Promise<{ hash: string; network: string }> {
  // TODO: use @stellar/stellar-sdk + Freighter signTransaction to call
  //   create_vesting_stream(sponsor, recipient, token, rate, cliff_duration, total_duration)
  void params
  await new Promise(r => setTimeout(r, 1400))
  const hash = Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
  return { hash, network: 'testnet' }
}

export function StepConfirm({ data, onBack, onDone }: Props) {
  const { address } = useWallet()
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [txHash, setTxHash] = useState('')
  const [txNetwork, setTxNetwork] = useState('testnet')

  async function submit() {
    setState('submitting')
    setErrorMsg('')
    try {
      const { hash, network } = await submitCreateStream({
        sponsor: address ?? data.walletAddress,
        recipient: data.recipient,
        token: data.tokenAddress,
        rate: Number(data.rate),
        cliffDuration: Number(data.cliffDuration),
        totalDuration: Number(data.totalDuration),
      })
      setTxHash(hash)
      setTxNetwork(network)
      setState('success')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed')
      setState('error')
    }
  }

  if (state === 'success') {
    const explorerUrl = `https://stellar.expert/explorer/${txNetwork}/tx/${txHash}`
    return (
      <div style={{ ...styles.card, alignItems: 'center', textAlign: 'center' }}>
        <div style={styles.successIcon} aria-hidden="true">✓</div>
        <h2 style={styles.heading}>Stream created!</h2>
        <p style={styles.sub}>
          Tokens are now locked in the vault. The recipient can claim after the cliff.
        </p>

        {/* Success toast with tx link */}
        <div
          role="status"
          data-testid="wizard-tx-success"
          style={{
            width: '100%',
            padding: '0.875rem 1rem',
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: 'var(--radius)',
            fontSize: '0.85rem',
            textAlign: 'left',
          }}
        >
          <p style={{ fontWeight: 700, color: 'var(--color-completed)', marginBottom: '0.35rem' }}>
            ✓ Transaction confirmed
          </p>
          <p style={{ margin: 0 }}>
            View on{' '}
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--color-active)', fontFamily: 'monospace', wordBreak: 'break-all' }}
              aria-label={`View transaction ${txHash} on Stellar Expert`}
            >
              Stellar Expert ↗
            </a>
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem', wordBreak: 'break-all' }}>
            {txHash}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={onDone}
          data-testid="wizard-done-btn"
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Confirm &amp; sign</h2>
      <p style={styles.sub}>
        Clicking <strong>Sign &amp; Submit</strong> will open Freighter for your approval.
      </p>

      <p style={styles.warn}>
        ⚠️ Once submitted you cannot undo the deposit (you may cancel the stream later, but fees
        are non-refundable).
      </p>

      {state === 'error' && (
        <p role="alert" style={styles.error} data-testid="wizard-submit-error">
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
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={state === 'submitting'}
          onClick={submit}
          aria-busy={state === 'submitting'}
          data-testid="wizard-submit-btn"
        >
          {state === 'submitting' ? 'Signing…' : 'Sign & Submit'}
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
