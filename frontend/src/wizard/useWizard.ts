import { useState, useCallback } from 'react'

export const WIZARD_STEPS = [
  'connect-wallet',
  'select-token',
  'set-amounts',
  'preview',
  'confirm',
] as const

export type WizardStep = (typeof WIZARD_STEPS)[number]

export interface WizardFormData {
  // connect-wallet
  walletAddress: string
  // select-token
  tokenAddress: string
  tokenSymbol: string
  // set-amounts
  rate: string          // tokens per ledger, raw input
  cliffDuration: string // ledgers
  totalDuration: string // ledgers
  recipient: string
}

const INITIAL_DATA: WizardFormData = {
  walletAddress: '',
  tokenAddress: '',
  tokenSymbol: '',
  rate: '',
  cliffDuration: '',
  totalDuration: '',
  recipient: '',
}

const LEDGERS_PER_SECOND = 0.2 // ~5 s per ledger

/** Convert a ledger count to a human-readable duration string. */
export function ledgersToDuration(ledgers: number): string {
  const seconds = ledgers / LEDGERS_PER_SECOND
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
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
