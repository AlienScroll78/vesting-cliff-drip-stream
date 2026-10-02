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
  rate: string          // tokens per ledger, raw input
  cliffDuration: string // ledgers
  totalDuration: string // ledgers
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

/** Average time between Stellar ledgers (~5 s). Shared with the date→ledger conversion. */
export const LEDGERS_PER_SECOND = 0.2

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

// ── Progress persistence (#822) ───────────────────────────────────────────────
// Form state is saved to localStorage on every change so an accidental back
// navigation, a refresh, or closing the browser mid-flow never loses progress.

const STORAGE_KEY = 'vesting_wizard_progress'

interface PersistedProgress {
  stepIndex: number
  data: WizardFormData
}

function loadProgress(): PersistedProgress | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedProgress
    if (typeof parsed?.stepIndex !== 'number') return null
    if (!parsed.data || typeof parsed.data !== 'object') return null
    // Guard against a corrupt or out-of-range step index.
    if (parsed.stepIndex < 0 || parsed.stepIndex >= WIZARD_STEPS.length) return null
    return parsed
  } catch {
    return null
  }
}

function saveProgress(stepIndex: number, data: WizardFormData) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stepIndex, data }))
  } catch {
    // Storage full or unavailable (private browsing) — persistence is best-effort.
  }
}

function clearProgress() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function useWizard() {
  // Restore any saved progress so a refresh or accidental back navigation
  // doesn't discard the user's answers (#822).
  const restored = useRef<PersistedProgress | null>(null)
  if (restored.current === null) restored.current = loadProgress()

  const [stepIndex, setStepIndex] = useState(
    () => restored.current?.stepIndex ?? getStepFromHash()
  )
  const [data, setData] = useState<WizardFormData>(
    () => restored.current?.data ?? INITIAL_DATA
  )
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const initialized = useRef(false)
  // Highest step reached this session — drives the ✓ checkmarks in the
  // step indicator (#822) and which steps are tappable.
  const [furthestStep, setFurthestStep] = useState(stepIndex)

  // Persist on every change; debounce isn't needed because these writes are
  // small and localStorage is synchronous.
  useEffect(() => {
    saveProgress(stepIndex, data)
  }, [stepIndex, data])

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
    setFurthestStep(f => Math.min(f + 1, totalSteps - 1))
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
    // Stream created (or abandoned) — drop the saved draft so the next run
    // starts clean.
    clearProgress()
    setStepIndex(0)
    setData(INITIAL_DATA)
    setTouched(new Set())
    setFurthestStep(0)
    setHash(WIZARD_STEPS[0] as WizardStep)
  }, [])

  const goToStep = useCallback((idx: number) => {
    setStepIndex(i => {
      const safe = Math.min(Math.max(idx, 0), i)
      setHash(WIZARD_STEPS[safe] as WizardStep)
      return safe
    })
  }, [])

  return {
    step, stepIndex, totalSteps, data, furthestStep,
    touched, next, back, update, touch, reset, goToStep,
    WIZARD_STEPS,
  }
}
