import { useWallet } from '../contexts/WalletContext'
import type { WizardFormData } from './useWizard'

interface Props {
  data: WizardFormData
  update: (patch: Partial<WizardFormData>) => void
  onNext: () => void
}

export function StepConnectWallet({ data, update, onNext }: Props) {
  const { address, connect } = useWallet()

  async function handleConnect() {
    try {
      await connect()
    } catch {
      // wallet will show its own error UI
    }
  }

  // sync wallet address into form data when it arrives
  const resolved = address ?? data.walletAddress

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Connect your wallet</h2>
      <p style={styles.sub}>
        You need a Freighter wallet to sign and pay for the stream deposit.
      </p>
      {resolved ? (
        <div style={styles.connected}>
          <span style={styles.check}>✓</span>
          <span data-testid="wizard-wallet-address" style={styles.addr}>
            {resolved.slice(0, 6)}…{resolved.slice(-4)}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={handleConnect}
          data-testid="wizard-connect-btn"
        >
          Connect Freighter
        </button>
      )}

      <button
        type="button"
        className="btn btn-primary btn-full"
        style={{ marginTop: '1.25rem' }}
        disabled={!resolved}
        onClick={() => {
          if (resolved) {
            update({ walletAddress: resolved })
            onNext()
          }
        }}
        data-testid="wizard-next-btn"
      >
        Continue →
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  heading: { fontSize: '1.25rem', fontWeight: 700 },
  sub: { fontSize: '0.9rem', color: '#6b7280' },
  connected: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.75rem', background: '#f0fdf4',
    borderRadius: 'var(--radius)', border: '1px solid #86efac',
  },
  check: { color: 'var(--color-completed)', fontWeight: 700 },
  addr: { fontFamily: 'monospace', fontSize: '0.875rem' },
}
