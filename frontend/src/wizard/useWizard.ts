import { useState, useCallback } from 'react'
import type { TFunction } from 'i18next'

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
export function ledgersToDuration(ledgers: number, t: TFunction): string {
  const seconds = ledgers / LEDGERS_PER_SECOND
  const [unit, value] = seconds < 60
    ? ['seconds', Math.round(seconds)]
    : seconds < 3600
      ? ['minutes', Math.round(seconds / 60)]
      : seconds < 86400
        ? ['hours', Math.round(seconds / 3600)]
        : ['days', Math.round(seconds / 86400)]
  return t(`duration.${unit}`, { count: value, value })
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
