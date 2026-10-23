import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "vesting_onboarding_complete";
const REPLAY_EVENT = "vesting:replay-onboarding-tour";

export type StreamState = "pre-cliff" | "active" | "completed";
export type TourMode = "dashboard" | "create-stream";

export interface TourStep {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
}

export function buildTourSteps(
  streamState: StreamState = "pre-cliff",
  mode: TourMode = "dashboard",
): TourStep[] {
  if (mode === "create-stream") {
    return [
      {
        id: "wallet",
        targetSelector: '[data-tour="wallet"]',
        title: "Connect your wallet",
        description: "Connect the Stellar wallet that will sponsor and fund this stream.",
      },
      {
        id: "streams",
        targetSelector: '[data-tour="streams"]',
        title: "Set the stream details",
        description: "Enter the sponsor, recipient, token, and drip rate for the stream.",
      },
      {
        id: "timeline",
        targetSelector: '[data-tour="claimable"]',
        title: "Choose the cliff",
        description: "The cliff date is when the recipient can first claim accrued tokens.",
      },
      {
        id: "create-stream",
        targetSelector: '[data-tour="create-stream"]',
        title: "Create the stream",
        description: "Review the schedule, then create the stream to begin vesting.",
      },
    ];
  }

  const timelineDescription =
    streamState === "pre-cliff"
      ? "Your tokens accrue over time, but the cliff must pass before you can claim them."
      : streamState === "active"
        ? "The cliff has passed, so accrued tokens can now be claimed while the stream continues."
        : "The stream has completed. This timeline shows how tokens unlocked over its lifetime.";

  const claimDescription =
    streamState === "pre-cliff"
      ? "Claim becomes available after the cliff has passed."
      : streamState === "completed"
        ? "The stream is complete. Review its history to see what was claimed."
        : "Choose Claim when you are ready to withdraw the tokens available now.";

  return [
    {
      id: "wallet",
      targetSelector: '[data-tour="wallet"]',
      title: "Your wallet",
      description: "Connect your Stellar wallet to see streams associated with your address.",
    },
    {
      id: "streams",
      targetSelector: '[data-tour="streams"]',
      title: "Your streams",
      description: "Each card shows a stream's recipient, status, and token balance.",
    },
    {
      id: "timeline",
      targetSelector: '[data-tour="claimable"]',
      title: "Vesting progress",
      description: timelineDescription,
    },
    {
      id: "create-stream",
      targetSelector: '[data-tour="create-stream"]',
      title: "Create a stream",
      description:
        "Sponsors choose a recipient, token allocation, cliff, and stream duration when creating a new stream.",
    },
    {
      id: "claim",
      targetSelector: '[data-tour="claim"]',
      title: "Claim tokens",
      description: claimDescription,
    },
  ];
}

export const TOUR_STEPS = buildTourSteps();

interface UseOnboardingTourOptions {
  enabled?: boolean;
  streamState?: StreamState;
  mode?: TourMode;
}

export function replayTour(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

export function useOnboardingTour(options: UseOnboardingTourOptions = {}) {
  const { enabled = true, streamState = "pre-cliff", mode = "dashboard" } = options;
  const [isActive, setIsActive] = useState(
    () => enabled && localStorage.getItem(STORAGE_KEY) !== "true",
  );
  const [currentStep, setCurrentStep] = useState(0);
  const steps = useMemo(() => buildTourSteps(streamState, mode), [mode, streamState]);

  const finish = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsActive(false);
    setCurrentStep(0);
  }, []);

  const skip = finish;

  const next = useCallback(() => {
    if (currentStep >= steps.length - 1) {
      finish();
      return;
    }
    setCurrentStep((step) => step + 1);
  }, [currentStep, finish, steps.length]);

  const prev = useCallback(() => {
    setCurrentStep((step) => Math.max(0, step - 1));
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.max(0, Math.min(steps.length - 1, step)));
  }, [steps.length]);

  const restart = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  useEffect(() => {
    if (enabled && localStorage.getItem(STORAGE_KEY) !== "true") {
      setIsActive(true);
    }
  }, [enabled]);

  useEffect(() => {
    const handleReplay = () => {
      setCurrentStep(0);
      setIsActive(true);
    };
    window.addEventListener(REPLAY_EVENT, handleReplay);
    return () => window.removeEventListener(REPLAY_EVENT, handleReplay);
  }, []);

  return {
    isActive,
    currentStep,
    currentStepData: isActive ? steps[currentStep] ?? null : null,
    totalSteps: steps.length,
    next,
    prev,
    skip,
    finish,
    restart,
    goToStep,
  };
}
