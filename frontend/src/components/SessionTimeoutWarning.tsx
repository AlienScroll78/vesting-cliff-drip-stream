"use client";
import { useEffect, useRef } from "react";
import { useModalFocus } from "@/hooks/useModalFocus";
import styles from "./SessionTimeoutWarning.module.css";

interface SessionTimeoutWarningProps {
  isOpen: boolean;
  timeRemaining: number; // in milliseconds
  onStayConnected: () => void;
  onDisconnect: () => void;
}

/**
 * Modal warning displayed when session is about to timeout.
 * Shows countdown timer and options to stay connected or disconnect.
 * WCAG 2.1 AA compliant: focus trap, screen reader announcements, keyboard accessible.
 */
export function SessionTimeoutWarning({
  isOpen,
  timeRemaining,
  onStayConnected,
  onDisconnect,
}: SessionTimeoutWarningProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Use focus trap for modal accessibility
  useModalFocus(modalRef, isOpen);

  // Format time remaining as MM:SS
  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);
  const formattedTime = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  // Announce time remaining to screen readers
  useEffect(() => {
    if (isOpen && timeRemaining <= 60000) {
      // Announce when less than 1 minute remaining
      const announcement = `Warning: Your session will expire in ${formattedTime}`;
      // Use aria-live region if available, otherwise create announcement
      const announcer = document.createElement("div");
      announcer.setAttribute("aria-live", "polite");
      announcer.setAttribute("aria-atomic", "true");
      announcer.className = styles.srOnly;
      announcer.textContent = announcement;
      document.body.appendChild(announcer);

      return () => {
        document.body.removeChild(announcer);
      };
    }
  }, [isOpen, timeRemaining, formattedTime]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div className={styles.backdrop} aria-hidden="true" />

      {/* Modal */}
      <div
        ref={modalRef}
        className={styles.modal}
        role="alertdialog"
        aria-labelledby="timeout-title"
        aria-describedby="timeout-description"
        tabIndex={-1}
      >
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 id="timeout-title" className={styles.title}>
              ⏱️ Session Timeout Warning
            </h2>
          </div>

          <div className={styles.body}>
            <p id="timeout-description" className={styles.description}>
              Your session will expire due to inactivity. You will be disconnected from your wallet.
            </p>

            <div className={styles.timerContainer}>
              <p className={styles.timerLabel}>Time remaining:</p>
              <div className={styles.timer} aria-live="polite" aria-atomic="true">
                {formattedTime}
              </div>
            </div>
          </div>

          <div className={styles.footer}>
            <button
              className={styles.buttonPrimary}
              onClick={onStayConnected}
              ref={closeButtonRef}
              aria-label="Stay connected to wallet"
            >
              Stay Connected
            </button>
            <button
              className={styles.buttonSecondary}
              onClick={onDisconnect}
              aria-label="Disconnect from wallet now"
            >
              Disconnect Now
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// Screen reader only class
