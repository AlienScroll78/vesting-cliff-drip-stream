import { useEffect } from 'react'
import introJs from 'intro.js'
import 'intro.js/introjs.css'

const STORAGE_KEY = 'vesting_tour_done'

/** Starts the guided onboarding tour for first-time visitors.
 *  Attaches to elements with data-intro / data-step attributes already in the DOM. */
export function useOnboardingTour() {
  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return

    const tour = introJs()
    tour.setOptions({
      steps: [
        {
          title: 'Welcome to Vesting Drips 👋',
          intro: 'This short tour shows you how cliff vesting works and how to get started.',
        },
        {
          element: document.querySelector('[data-tour="wallet"]') ?? undefined,
          title: 'Connect your wallet',
          intro: 'Start by connecting your Stellar wallet. This identifies you as a sponsor or recipient.',
        },
        {
          element: document.querySelector('[data-tour="cliff"]') ?? undefined,
          title: 'What is a cliff?',
          intro:
            'A cliff is a lock-up period. No tokens can be claimed until the cliff date passes. After that, all accrued tokens unlock instantly.',
        },
        {
          element: document.querySelector('[data-tour="create-stream"]') ?? undefined,
          title: 'Create a stream (sponsors)',
          intro: 'Sponsors deposit tokens and set the rate, cliff, and total duration for a recipient.',
        },
        {
          element: document.querySelector('[data-tour="claim"]') ?? undefined,
          title: 'Claim vested tokens (recipients)',
          intro: 'Once the cliff has passed, recipients can claim their vested tokens here at any time.',
        },
      ],
      exitOnOverlayClick: true,
      showBullets: true,
      showProgress: true,
      disableInteraction: false,
    })

    tour.oncomplete(() => localStorage.setItem(STORAGE_KEY, '1'))
    tour.onexit(() => localStorage.setItem(STORAGE_KEY, '1'))

    // Small delay so DOM is fully painted before attaching
    const timer = setTimeout(() => tour.start(), 600)
    return () => clearTimeout(timer)
  }, [])
}
