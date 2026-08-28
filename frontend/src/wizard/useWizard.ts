import { useState, useCallback } from 'react'

export const WIZARD_STEPS = [
  'connect-wallet',
  'select-recipient',
  'select-token',
  'set-amounts',
  'preview',
  'confirm',
] as const

export type WizardStep = (typeof WIZARD_STEPS)[number]

export interface WizardFormData {
  // connect-wallet
  walletAddress: string
  // select-recipient
  recipient: string
  // select-token
  tokenAddress: string
  tokenSymbol: string
  // set-amounts
  rate: string          // tokens per ledger, raw input
  cliffDuration: string // ledgers
  totalDuration: string // ledgers
}

const INITIAL_DATA: WizardFormData = {
  walletAddress: '',
  recipient: '',
  tokenAddress: '',
  tokenSymbol: '',
  rate: '',
  cliffDuration: '',
  totalDuration: '',
}

const LEDGERS_PER_SECOND = 0.2 // ~5 s per ledger

/** i128::MAX value for overflow detection */
export const I128_MAX = BigInt('170141183460469231731687303715884105727')

/** Convert a ledger count to a human-readable duration string. */
export function ledgersToDuration(ledgers: number): string {
  const seconds = ledgers / LEDGERS_PER_SECOND
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  if (seconds < 86400 * 30) return `${Math.round(seconds / 86400)}d`
  if (seconds < 86400 * 365) return `${(seconds / (86400 * 30)).toFixed(1)}mo`
  return `${(seconds / (86400 * 365)).toFixed(1)}yr`
}

/**
 * Client-side equivalent of Rust checked_mul: returns true when
 * rate * totalDuration would overflow i128.
 */
export function isDepositOverflow(rate: number, totalDuration: number): boolean {
  if (rate <= 0 || totalDuration <= 0) return false
  try {
    const deposit = BigInt(Math.floor(rate)) * BigInt(Math.floor(totalDuration))
    return deposit > I128_MAX
  } catch {
    return true
  }
}

export function useWizard() {
  const [stepIndex, setStepIndex] = useState(0)
  const [data, setData] = useState<WizardFormData>(INITIAL_DATA)

  const step = WIZARD_STEPS[stepIndex]
  const totalSteps = WIZARD_STEPS.length

  const next = useCallback(() => {
    setStepIndex(i => Math.min(i + 1, totalSteps - 1))
  }, [totalSteps])

  const back = useCallback(() => {
    setStepIndex(i => Math.max(i - 1, 0))
  }, [])

  const update = useCallback((patch: Partial<WizardFormData>) => {
    setData(d => ({ ...d, ...patch }))
  }, [])

  const reset = useCallback(() => {
    setStepIndex(0)
    setData(INITIAL_DATA)
  }, [])

  return { step, stepIndex, totalSteps, data, next, back, update, reset }
}
