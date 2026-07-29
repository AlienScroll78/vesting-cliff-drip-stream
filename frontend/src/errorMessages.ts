export interface ErrorInfo {
  title: string
  explanation: string
  action: string
  faqUrl?: string
}

/** Maps every VestingError code to a user-friendly message. */
export const errorMessages: Record<number, ErrorInfo> = {
  1: {
    title: 'Schedule not found',
    explanation: 'No active vesting schedule exists for this wallet address.',
    action: 'Ask your sponsor to create a stream for your address.',
    faqUrl: '#faq-schedule-not-found',
  },
  2: {
    title: 'Cliff not reached yet',
    explanation: 'Your tokens are still locked. The cliff period has not passed.',
    action: 'Check the cliff date and come back then.',
    faqUrl: '#faq-cliff',
  },
  3: {
    title: 'Invalid duration',
    explanation: 'The total vesting duration must be longer than the cliff duration.',
    action: 'Increase the total duration or decrease the cliff duration.',
  },
  4: {
    title: 'Invalid rate',
    explanation: 'The token rate per ledger must be a positive number greater than zero.',
    action: 'Enter a rate of at least 1.',
  },
  5: {
    title: 'Deposit overflow',
    explanation: 'The computed total deposit is too large to process.',
    action: 'Reduce the rate or duration so the total deposit stays within limits.',
    faqUrl: '#faq-overflow',
  },
  6: {
    title: 'Schedule already exists',
    explanation: 'A vesting stream is already active for this recipient.',
    action: 'Cancel the existing stream before creating a new one.',
  },
  7: {
    title: 'Nothing to claim',
    explanation: 'There are no tokens available to claim at this moment.',
    action: 'Wait for more tokens to accrue and try again.',
  },
}

export function getErrorInfo(code: number): ErrorInfo {
  return (
    errorMessages[code] ?? {
      title: 'Unexpected error',
      explanation: `An unknown error occurred (code ${code}).`,
      action: 'Please try again or contact support.',
    }
  )
}
