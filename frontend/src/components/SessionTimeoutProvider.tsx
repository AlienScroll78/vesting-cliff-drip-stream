"use client";
import { ReactNode } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import { SessionTimeoutWarning } from "./SessionTimeoutWarning";

/**
 * Provider component that wraps the application with session timeout protection.
 * Monitors inactivity, shows warning, and auto-disconnects after timeout.
 */
export function SessionTimeoutProvider({ children }: { children: ReactNode }) {
  const { disconnect } = useWallet();

  const { isWarning, timeRemaining, dismiss } = useSessionTimeout({
    inactivityMs: 20 * 60 * 1000, // 20 minutes
    warningDurationMs: 10 * 60 * 1000, // 10 minutes
    onExpire: () => {
      disconnect();
    },
  });

  return (
    <>
      {children}
      <SessionTimeoutWarning
        isOpen={isWarning}
        timeRemaining={timeRemaining}
        onStayConnected={dismiss}
        onDisconnect={disconnect}
      />
    </>
  );
}
