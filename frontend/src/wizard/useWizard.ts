import { useState, useCallback, useEffect, useRef } from 'react'
import { z } from 'zod'

export const WIZARD_STEPS = [
  'recipient',
  'token',
  'schedule',
  'review',
] as const

export type WizardStep = (typeof WIZARD_STEPS)[number]

export const recipientSchema = z.object({
  recipient: z
    .string()
    .min(1, 'Recipient address is required')
    .regex(/^G[A-Z2-7]{55}$/, 'Must be a valid Stellar address starting with G (56 characters)'),
})

export const tokenSchema = z.object({
  tokenAddress: z
    .string()
    .min(1, 'Token contract address is required')
    .regex(/^C[A-Z2-7]{55}$/, 'Must be a valid SAC contract address starting with C (56 characters)'),
  tokenSymbol: z.string().min(1),
})

export const scheduleSchema = z.object({
  rate: z.string().min(1, 'Rate is required').refine(
    (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 },
    'Rate must be a positive integer'
  ),
  cliffDuration: z.string().min(1, 'Cliff duration is required').refine(
    (v) => { const n = Number(v); return !isNaN(n) && n > 0 },
    'Cliff must be a positive number'
  ),
  totalDuration: z.string().min(1, 'Total duration is required').refine(
    (v) => { const n = Number(v); return !isNaN(n) && n > 0 },
    'Total must be a positive number'
  ),
}).refine(
  (data) => {
    const cliff = Number(data.cliffDuration)
    const total = Number(data.totalDuration)
    return cliff < total
  },
  { message: 'Cliff duration must be less than total duration', path: ['cliffDuration'] }
)

export const STEP_SCHEMAS: Record<WizardStep, z.ZodType> = {
  recipient: recipientSchema,
  token: tokenSchema,
  schedule: scheduleSchema,
  review: z.object({}),
}

export interface WizardFormData {
  recipient: string
  tokenAddress: string
  tokenSymbol: string
  rate: string
  cliffDuration: string
  totalDuration: string
  walletAddress: string
}

const INITIAL_DATA: WizardFormData = {
  recipient: '',
  tokenAddress: '',
  tokenSymbol: '',
  rate: '',
  cliffDuration: '',
  totalDuration: '',
  walletAddress: '',
}

const LEDGERS_PER_SECOND = 0.2

export function ledgersToDuration(ledgers: number): string {
  const seconds = ledgers / LEDGERS_PER_SECOND
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

function getStepFromHash(): number {
  if (typeof window === 'undefined') return 0
  const hash = window.location.hash.replace('#', '')
  const idx = (WIZARD_STEPS as readonly string[]).indexOf(hash)
  return idx >= 0 ? idx : 0
}

function setHash(step: WizardStep) {
  if (typeof window !== 'undefined') {
    window.location.hash = step
  }
}

export function useWizard() {
  const [stepIndex, setStepIndex] = useState(getStepFromHash)
  const [data, setData] = useState<WizardFormData>(INITIAL_DATA)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const initialized = useRef(false)

  useEffect(() => {
    if (!initialized.current) {
      setHash(WIZARD_STEPS[stepIndex] as WizardStep)
      initialized.current = true
    }
  }, [stepIndex])

  useEffect(() => {
    const handler = () => {
      const idx = getStepFromHash()
      setStepIndex(idx)
    }
    window.addEventListener('hashchange', handler as EventListener)
    return () => window.removeEventListener('hashchange', handler as EventListener)
  }, [])

  const step = WIZARD_STEPS[stepIndex] as WizardStep
  const totalSteps = WIZARD_STEPS.length

  const next = useCallback(() => {
    setStepIndex(i => {
      const nextIdx = Math.min(i + 1, totalSteps - 1)
      setHash(WIZARD_STEPS[nextIdx] as WizardStep)
      return nextIdx
    })
  }, [totalSteps])

  const back = useCallback(() => {
    setStepIndex(i => {
      const prevIdx = Math.max(i - 1, 0)
      setHash(WIZARD_STEPS[prevIdx] as WizardStep)
      return prevIdx
    })
  }, [])

  const update = useCallback((patch: Partial<WizardFormData>) => {
    setData(d => ({ ...d, ...patch }))
  }, [])

  const touch = useCallback((field: string) => {
    setTouched(prev => new Set(prev).add(field))
  }, [])

  const reset = useCallback(() => {
    setStepIndex(0)
    setData(INITIAL_DATA)
    setTouched(new Set())
    setHash(WIZARD_STEPS[0] as WizardStep)
  }, [])

  const goToStep = useCallback((idx: number) => {
    setStepIndex(idx)
    setHash(WIZARD_STEPS[idx] as WizardStep)
  }, [])

  return {
    step, stepIndex, totalSteps, data,
    touched, next, back, update, touch, reset, goToStep,
    WIZARD_STEPS,
  }
}
