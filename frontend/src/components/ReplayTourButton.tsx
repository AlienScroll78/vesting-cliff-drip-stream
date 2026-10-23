"use client";

import { replayTour } from "@/useOnboardingTour";

/**
 * Settings → "Replay tour" control (#820).
 *
 * Reopens the onboarding tour from step 0 regardless of the persisted
 * "already seen" flag, so returning users can re-watch it any time.
 */
export function ReplayTourButton() {
  return (
    <button
      type="button"
      className="btn btn-outline"
      style={{ fontSize: "0.875rem" }}
      onClick={replayTour}
      data-testid="replay-tour"
    >
      ↻ Replay tour
    </button>
  );
}

export default ReplayTourButton;
