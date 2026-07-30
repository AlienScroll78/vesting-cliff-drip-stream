import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

const DURATION = 0.25 // ≤ 300 ms

/** Fade + slide-up page transition. Skipped when prefers-reduced-motion. */
export function PageTransition({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: DURATION, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

/** Modal open/close animation wrapper. */
export function ModalTransition({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal"
          initial={reduced ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: DURATION, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Animated number counter for a claimable balance value. */
export function AnimatedBalance({ value }: { value: number }) {
  const reduced = useReducedMotion()
  return (
    <motion.span
      key={value}
      initial={reduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION }}
    >
      {value.toLocaleString()}
    </motion.span>
  )
}

/** Progress bar that animates from 0 → pct on mount. */
export function AnimatedProgressBar({ pct }: { pct: number }) {
  const reduced = useReducedMotion()
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ background: 'var(--border)', borderRadius: 4, height: 8, overflow: 'hidden' }}
    >
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: reduced ? `${pct}%` : `${pct}%` }}
        transition={reduced ? { duration: 0 } : { duration: DURATION, ease: 'easeOut' }}
        style={{ background: 'var(--accent)', height: '100%' }}
      />
    </div>
  )
}
