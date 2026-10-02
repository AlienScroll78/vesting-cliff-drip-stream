import { useState, useMemo } from 'react'
import { ledgersToDuration, isDepositOverflow } from './useWizard'
import type { WizardFormData } from './useWizard'
import styles from './wizard.module.css'

interface Props {
  data: WizardFormData
  onNext: () => void
  onBack: () => void
  onDone: () => void
}

type State = 'idle' | 'submitting' | 'success' | 'error'

export function StepReview({ data, onNext, onBack, onDone }: Props) {
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [txHash, setTxHash] = useState<string | null>(null)

  const cliff = Number(data.cliffDuration)
  const total = Number(data.totalDuration)
  const rate = Number(data.rate)
  const deposit = rate * total

  const overflow = isDepositOverflow(rate, total)

  const costBreakdown = useMemo(() => {
    const cliffTokens = rate * cliff
    const linearTokens = rate * (total - cliff)
    return { cliffTokens, linearTokens, totalDeposit: deposit }
  }, [rate, cliff, total, deposit])

  async function submit() {
    if (overflow) return
    setState('submitting')
    try {
      // TODO: call create_vesting_stream via Freighter and obtain real tx hash
      await new Promise(r => setTimeout(r, 1200))
      const mockHash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      setTxHash(mockHash)
      setState('success')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed')
      setState('error')
    }
  }

  if (state === 'success') {
    const network = data.walletAddress ? 'testnet' : 'testnet'
    const explorerBase = network === 'mainnet'
      ? 'https://stellar.expert/explorer/public/tx/'
      : 'https://stellar.expert/explorer/testnet/tx/'
    return (
      <div className={styles.step} style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className={styles.successIcon}>✓</div>
        <h2 className={styles.stepHeading}>Stream created!</h2>
        <p className={styles.stepSub}>
          Tokens are now locked. The recipient can claim after the cliff.
        </p>
        {txHash && (
          <a
            href={`${explorerBase}${txHash}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '0.8rem', color: 'var(--color-active, #1d6ae5)', fontFamily: 'monospace', wordBreak: 'break-all' }}
            data-testid="tx-explorer-link"
          >
            View on Stellar Expert ↗
          </a>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={onDone}
            data-testid="wizard-done-btn"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.step}>
      <h2 className={styles.stepHeading}>Review stream</h2>
      <p className={styles.stepSub}>Review all values before signing. Nothing is sent until you confirm.</p>

      {/* Scrollable summary so long addresses never push the CTA off-screen (#822). */}
      <div className={styles.summaryScroll}>
        <dl className={styles.summary}>
          <Row label="Recipient" value={data.recipient} mono />
          <Row label="Token" value={`${data.tokenSymbol} (${data.tokenAddress.slice(0, 8)}…)`} />
          <Row label="Rate" value={`${rate.toLocaleString()} tokens / ledger`} />
          <Row
            label="Cliff"
            value={`${cliff.toLocaleString()} ledgers ≈ ${ledgersToDuration(cliff)}`}
          />
          <Row
            label="Total duration"
            value={`${total.toLocaleString()} ledgers ≈ ${ledgersToDuration(total)}`}
          />
        </dl>

        <div className={styles.costBreakdown}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Cost breakdown</h3>
          <div className={styles.costRow}>
            <span>Cliff release</span>
            <span>{costBreakdown.cliffTokens.toLocaleString()} {data.tokenSymbol}</span>
          </div>
          <div className={styles.costRow}>
            <span>Linear streaming</span>
            <span>{costBreakdown.linearTokens.toLocaleString()} {data.tokenSymbol}</span>
          </div>
          <div
            className={styles.costRow}
            style={{
              fontWeight: 700,
              borderTop: '1px solid var(--color-border, #e5e7eb)',
              paddingTop: '0.5rem',
              marginTop: '0.25rem',
            }}
          >
            <span>Total deposit</span>
            <span data-testid="preview-total-deposit">{costBreakdown.totalDeposit.toLocaleString()} {data.tokenSymbol}</span>
          </div>
        </div>
      </div>

      {overflow && (
        <div role="alert" className={styles.warning} data-testid="overflow-warning">
          <strong>Too large:</strong> rate × total duration is more than this contract can
          track. Reduce the rate or duration.
        </div>
      )}

      <div className={styles.warning}>
        The full deposit of <strong>{deposit.toLocaleString()} {data.tokenSymbol || 'tokens'}</strong> will be
        transferred from your wallet on confirmation. Once submitted you cannot undo the deposit.
      </div>

      {state === 'error' && (
        <p role="alert" className={styles.error}>
          {errorMsg}
        </p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={onBack}
          disabled={state === 'submitting'}
          data-testid="wizard-back-btn"
        >
          ← Back
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={state === 'submitting' || overflow}
          onClick={submit}
          data-testid="wizard-submit-btn"
        >
          {state === 'submitting' ? 'Signing…' : 'Confirm & Sign'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: 600 }}>{label}</dt>
      <dd
        data-testid={`preview-${label.toLowerCase().replace(/\s+/g, '-')}`}
        style={{
          fontSize: '0.9rem',
          fontFamily: mono ? 'monospace' : undefined,
          wordBreak: 'break-all',
          marginBottom: '0.5rem',
        }}
      >
        {value}
      </dd>
    </>
  )
}
