import { useEffect, useRef, useCallback, useState } from "react";

/**
 * Configuration for session timeout behavior
 */
export interface SessionTimeoutConfig {
  /** Inactivity period before warning (ms) */
  inactivityMs?: number;
  /** Duration of warning countdown before disconnect (ms) */
  warningDurationMs?: number;
  /** Callback when timeout warning appears */
  onWarning?: () => void;
  /** Callback when session expires and disconnect happens */
  onExpire?: () => void;
  /** Custom activity event types to monitor */
  activityEvents?: string[];
  /** Whether to enable the hook (default: true) */
  enabled?: boolean;
}

const DEFAULT_INACTIVITY_MS = 20 * 60 * 1000; // 20 minutes
const DEFAULT_WARNING_DURATION_MS = 10 * 60 * 1000; // 10 minutes

interface UseSessionTimeoutResult {
  isWarning: boolean;
  timeRemaining: number; // ms until disconnect
  dismiss: () => void;
  resetActivity: () => void;
}

/**
 * Hook to track user activity and enforce session timeout with warning.
 * Detects mouse move, key press, scroll, and click events.
 * Shows warning at inactivityMs, auto-disconnects at inactivityMs + warningDurationMs.
 */
export function useSessionTimeout(config: SessionTimeoutConfig = {}): UseSessionTimeoutResult {
  const {
    inactivityMs = DEFAULT_INACTIVITY_MS,
    warningDurationMs = DEFAULT_WARNING_DURATION_MS,
    onWarning,
    onExpire,
    activityEvents = ["mousemove", "keydown", "scroll", "click"],
    enabled = true,
  } = config;

  const lastActivityRef = useRef<number>(Date.now());
  const inactivityTimeoutRef = useRef<NodeJS.Timeout>();
  const warningTimeoutRef = useRef<NodeJS.Timeout>();
  const countdownIntervalRef = useRef<NodeJS.Timeout>();

  const [isWarning, setIsWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(warningDurationMs);

  // Reset activity timestamp and clear timeouts
  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIsWarning(false);
    setTimeRemaining(warningDurationMs);

    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }
    if (warningTimeoutRef.current) {
      clearTimeout(warningTimeoutRef.current);
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    // Set new inactivity timeout
    if (enabled) {
      inactivityTimeoutRef.current = setTimeout(() => {
        setIsWarning(true);
        onWarning?.();

        // Start countdown
        let remaining = warningDurationMs;
        countdownIntervalRef.current = setInterval(() => {
          remaining -= 1000;
          setTimeRemaining(Math.max(0, remaining));
        }, 1000);

        // Set expiration timeout
        warningTimeoutRef.current = setTimeout(() => {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
          }
          setIsWarning(false);
          onExpire?.();
        }, warningDurationMs);
      }, inactivityMs);
    }
  }, [inactivityMs, warningDurationMs, enabled, onWarning, onExpire]);

  // Dismiss warning (called when user clicks "Stay connected")
  const dismiss = useCallback(() => {
    resetActivity();
  }, [resetActivity]);

  // Set up activity event listeners
  useEffect(() => {
    if (!enabled) return;

    const handleActivity = () => {
      if (isWarning) {
        // If warning is already showing, only dismiss on explicit button click
        // Don't auto-dismiss on activity while warning is visible
        return;
      }
      resetActivity();
    };

    activityEvents.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Initialize timers
    resetActivity();

    return () => {
      activityEvents.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });

      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [enabled, resetActivity, isWarning, activityEvents]);

  return {
    isWarning,
    timeRemaining,
    dismiss,
    resetActivity,
  };
}
