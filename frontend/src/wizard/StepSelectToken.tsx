import { useState } from 'react'
import { Tooltip } from '../Tooltip'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  update: (patch: Partial<WizardFormData>) => void
  onNext: () => void
  onBack: () => void
}

// Well-known testnet SAC tokens for quick selection
const PRESETS = [
  { symbol: 'USDC', address: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' },
  { symbol: 'XLM',  address: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC' },
]

export function StepSelectToken({ data, update, onNext, onBack }: Props) {
  const [custom, setCustom] = useState(
    data.tokenAddress && !PRESETS.find(p => p.address === data.tokenAddress)
      ? data.tokenAddress
      : ''
  )

  const selected = data.tokenAddress
  const canContinue = selected.length > 0

  function pick(address: string, symbol: string) {
    setCustom('')
    update({ tokenAddress: address, tokenSymbol: symbol })
  }

  function handleCustomChange(val: string) {
    setCustom(val)
    update({ tokenAddress: val, tokenSymbol: val.slice(0, 6) })
  }

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
            className={`btn ${selected === p.address ? 'btn-primary' : 'btn-outline'}`}
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
          style={styles.input}
          data-testid="wizard-token-custom"
        />
      </label>

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
}
