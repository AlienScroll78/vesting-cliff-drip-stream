import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Onboarding tour — issue #820.
 *
 * A dependency-free, step-by-step overlay that walks first-time users through
 * the key UI elements (timeline, claimable balance, claim button, wallet).
 *
 * Behaviour:
 *  - Auto-starts on the first eligible visit (gated by `enabled`, which the
 *    app wires to "wallet is connected").
 *  - Shown only once: skipping or finishing persists a localStorage flag.
 *  - Content adapts to the stream state (pre-cliff vs post-cliff).
 *  - Fully keyboard accessible (handled in `components/OnboardingTour.tsx`).
 *  - Can be replayed at any time from Settings via `replayTour()`.
 */

/** localStorage key holding the "tour already seen" flag. */
export const TOUR_STORAGE_KEY = "vesting_onboarding_complete";

/** Lifecycle state of the stream the user is looking at. */
export type StreamState = "pre-cliff" | "active" | "completed";

export interface TourStep {
  /** Stable identifier, also used as the React key and test hook. */
  id: string;
  /**
   * CSS selector for the element to spotlight. `null` renders the step as a
   * centred card with no highlight (used for the closing note).
   */
  targetSelector: string | null;
  title: string;
  description: string;
}

/**
 * Builds the step list for a given stream state.
 *
 * Pre-cliff users see "your tokens are still locked" framing; post-cliff users
 * see "your cliff has passed, go claim" framing.
 */
export function buildTourSteps(state: StreamState): TourStep[] {
  const preCliff = state === "pre-cliff";

  return [
    {
      id: "timeline",
      targetSelector: '[data-tour="timeline"]',
      title: "Your vesting timeline",
      description: preCliff
        ? "This is your vesting timeline. The cliff must pass before you can claim."
        : "This is your vesting timeline. Your cliff has passed, so tokens are unlocking now.",
    },
    {
      id: "claimable",
      targetSelector: '[data-tour="claimable"]',
      title: "Claimed and claimable",
      description: preCliff
        ? "This bar shows how much has been claimed (green) and what's claimable now (yellow). Right now the whole bar is locked until your cliff."
        : "This bar shows how much has been claimed (green) and what's claimable now (yellow).",
    },
    {
      id: "claim",
      targetSelector: '[data-tour="claim"]',
      title: "The Claim button",
      description: preCliff
        ? "Once your cliff passes, the Claim button activates here. Until then it stays disabled."
        : "Your cliff has passed, so the Claim button is active here.",
    },
    {
      id: "wallet",
      targetSelector: '[data-tour="wallet"]',
      title: "Connect your wallet",
      description: "Connect your wallet to sign and submit your claim transaction.",
    },
    {
      id: "revisit",
      targetSelector: null,
      title: "That's everything",
      description:
        "You can come back to claim at any time — tokens drip linearly after the cliff.",
    },
  ];
}

/** Default (pre-cliff) step list, kept for direct access in tests and stories. */
export const TOUR_STEPS: TourStep[] = buildTourSteps("pre-cliff");

// ── Storage helpers (all guarded — localStorage can throw in private mode) ─────

function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, "true");
  } catch {
    /* storage unavailable — the tour will simply show again next visit */
  }
}

function clearTourSeen(): void {
  try {
    localStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Replay bus ────────────────────────────────────────────────────────────────
// Lets the Settings "Replay tour" button restart the tour without prop drilling
// or duplicating hook state.

const REPLAY_EVENT = "vesting:replay-tour";

/** Restarts the onboarding tour from step 0, wherever it is mounted. */
export function replayTour(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseOnboardingTourOptions {
  /**
   * Gate for auto-start. The app passes `address !== null` so the tour only
   * appears after a wallet is connected. Defaults to `true`.
   */
  enabled?: boolean;
  /** Stream state used to pick the step copy. Defaults to `"pre-cliff"`. */
  streamState?: StreamState;
}

export function useOnboardingTour(options: UseOnboardingTourOptions = {}) {
  const { enabled = true, streamState = "pre-cliff" } = options;

  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  /**
   * Guards the auto-start effect so it can only ever run once per mount. Without
   * this, re-rendering after `finish()` would immediately restart the tour.
   */
  const autoStarted = useRef(false);

  const steps = useMemo(() => buildTourSteps(streamState), [streamState]);
  const totalSteps = steps.length;

  // Auto-start on the first eligible visit.
  useEffect(() => {
    if (!enabled) return;
    if (autoStarted.current) return;
    autoStarted.current = true;
    if (hasSeenTour()) return;
    setCurrentStep(0);
    setIsActive(true);
  }, [enabled]);

  // Listen for replay requests coming from the Settings screen.
  useEffect(() => {
    const handler = () => {
      clearTourSeen();
      setCurrentStep(0);
      setIsActive(true);
    };
    window.addEventListener(REPLAY_EVENT, handler);
    return () => window.removeEventListener(REPLAY_EVENT, handler);
  }, []);

  const finish = useCallback(() => {
    markTourSeen();
    setIsActive(false);
    setCurrentStep(0);
  }, []);

  const skip = useCallback(() => {
    markTourSeen();
    setIsActive(false);
  }, []);

  const restart = useCallback(() => {
    clearTourSeen();
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const next = useCallback(() => {
    if (currentStep >= totalSteps - 1) {
      finish();
      return;
    }
    setCurrentStep(currentStep + 1);
  }, [currentStep, totalSteps, finish]);

  const prev = useCallback(() => {
    setCurrentStep((step) => Math.max(0, step - 1));
  }, []);

  /** Jumps to an absolute step index, clamped to the valid range. */
  const goToStep = useCallback(
    (index: number) => {
      setCurrentStep(Math.min(Math.max(index, 0), totalSteps - 1));
    },
    [totalSteps],
  );

  const currentStepData = isActive ? (steps[currentStep] ?? null) : null;

  return {
    isActive,
    currentStep,
    currentStepData,
    totalSteps,
    next,
    prev,
    skip,
    finish,
    restart,
    goToStep,
  };
}

// __CHUNK2__

