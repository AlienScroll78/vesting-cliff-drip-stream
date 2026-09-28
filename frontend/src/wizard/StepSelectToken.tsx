import { useState, useCallback, useMemo } from 'react'
import { useWallet } from '../contexts/WalletContext'
import { Tooltip } from '../Tooltip'
import { tokenSchema } from './useWizard'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  update: (patch: Partial<WizardFormData>) => void
  touch: (field: string) => void
  touched: Set<string>
  onNext: () => void
  onBack: () => void
}

const PRESETS = [
  { symbol: 'USDC', address: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' },
  { symbol: 'XLM',  address: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC' },
]

export function StepSelectToken({ data, update, touch, touched, onNext, onBack }: Props) {
  const { balances, balancesLoading } = useWallet()
  const [custom, setCustom] = useState(
    data.tokenAddress && !PRESETS.find(p => p.address === data.tokenAddress)
      ? data.tokenAddress
      : ''
  )
  const [blurred, setBlurred] = useState(false)

  const result = tokenSchema.safeParse({
    tokenAddress: data.tokenAddress,
    tokenSymbol: data.tokenSymbol,
  })
  const schemaError = (blurred || touched.has('tokenAddress')) && !result.success
    ? result.error.issues[0]?.message
    : null

  const selectedBalance = useMemo(
    () => balances.find(b => b.contractAddress === data.tokenAddress),
    [balances, data.tokenAddress]
  )
  const balanceOk = selectedBalance
    ? parseFloat(selectedBalance.balance) > 0
    : null

  const canContinue = result.success && data.tokenAddress.length > 0

  const pick = useCallback((address: string, symbol: string) => {
    setCustom('')
    update({ tokenAddress: address, tokenSymbol: symbol })
  }, [update])

  const handleCustomChange = useCallback((val: string) => {
    setCustom(val)
    update({ tokenAddress: val, tokenSymbol: val.slice(0, 6) })
  }, [update])

  const handleBlur = useCallback(() => {
    setBlurred(true)
    touch('tokenAddress')
  }, [touch])

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Select token</h2>
      <p style={styles.sub}>
        Choose the SAC token to stream. The sponsor wallet must hold enough to cover the full deposit.
      </p>

      <div style={styles.presets}>
        {PRESETS.map(p => (
          <button
            key={p.address}
            type="button"
            className={`btn ${data.tokenAddress === p.address ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => pick(p.address, p.symbol)}
            data-testid={`wizard-token-${p.symbol.toLowerCase()}`}
          >
            {p.symbol}
          </button>
        ))}
      </div>

      <label style={styles.label}>
        <span>
          Custom token contract{' '}
          <Tooltip content="Stellar Asset Contract (SAC) address starting with C. Must be an issued Soroban token on this network." />
        </span>
        <input
          type="text"
          placeholder="C…"
          value={custom}
          onChange={e => handleCustomChange(e.target.value.trim())}
          onBlur={handleBlur}
          aria-invalid={!!schemaError}
          style={{
            ...styles.input,
            borderColor: schemaError ? 'var(--color-cancelled)' : 'var(--color-border)',
          }}
          data-testid="wizard-token-custom"
        />
        {schemaError && (
          <span role="alert" style={styles.error} data-testid="token-error">
            {schemaError}
          </span>
        )}
      </label>

      {data.tokenAddress && balanceOk === false && (
        <p role="alert" style={styles.warning}>
          ⚠ Your wallet has 0 {selectedBalance?.assetCode || 'tokens'}.
          You need a positive balance to fund the stream deposit.
        </p>
      )}

      {balancesLoading && data.tokenAddress && (
        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>Checking balance…</p>
      )}

      {data.tokenAddress && selectedBalance && balanceOk && (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-completed)' }}>
          ✓ Balance: {parseFloat(selectedBalance.balance).toLocaleString()} {selectedBalance.assetCode}
        </p>
      )}

      <div style={styles.actions}>
        <button type="button" className="btn btn-ghost" onClick={onBack} data-testid="wizard-back-btn">
          ← Back
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canContinue}
          onClick={onNext}
          data-testid="wizard-next-btn"
        >
          Continue →
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  heading: { fontSize: '1.25rem', fontWeight: 700 },
  sub: { fontSize: '0.9rem', color: '#6b7280' },
  presets: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.375rem', fontSize: '0.875rem', fontWeight: 600 },
  input: {
    padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--color-border)', fontFamily: 'monospace', fontSize: '0.875rem',
    outline: 'none', width: '100%',
  },
  actions: { display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' },
  warning: {
    fontSize: '0.85rem', padding: '0.5rem 0.75rem',
    background: '#fffbeb', border: '1px solid #fde68a',
    borderRadius: 'var(--radius)',
  },
  error: { fontSize: '0.8rem', color: 'var(--color-cancelled)' },
}
