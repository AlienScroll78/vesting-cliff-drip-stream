import { useCallback, useEffect, useState } from "react";
import { OnboardingModal } from "./OnboardingModal";
import { OnboardingTour } from "./OnboardingTour";
import type { TourMode } from "../useOnboardingTour";

const INTRO_STORAGE_KEY = "vesting_intro_complete";

export function OnboardingExperience({
  tourMode = "dashboard",
}: {
  tourMode?: TourMode;
}) {
  const [isReady, setIsReady] = useState(false);
  const [introComplete, setIntroComplete] = useState(false);

  useEffect(() => {
    setIntroComplete(localStorage.getItem(INTRO_STORAGE_KEY) === "true");
    setIsReady(true);
  }, []);

  const dismissIntro = useCallback(() => {
    localStorage.setItem(INTRO_STORAGE_KEY, "true");
    setIntroComplete(true);
  }, []);

  return (
    <>
      {isReady && (
        <OnboardingTour enabled={introComplete} mode={tourMode} />
      )}
      {isReady && !introComplete && (
        <OnboardingModal onDismiss={dismissIntro} />
      )}
    </>
  );
}

export default OnboardingExperience;
