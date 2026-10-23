import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { GlossaryTerm } from "./GlossaryTerm";
import styles from "./OnboardingModal.module.css";

const steps = [
  {
    title: "What is a vesting stream?",
    description: (
      <>
        A vesting stream releases a token allocation over time. The{" "}
        <GlossaryTerm term="sponsor" /> deposits the full amount up front, and
        tokens accrue as each <GlossaryTerm term="ledger" /> closes.
      </>
    ),
  },
  {
    title: "What is a cliff?",
    description: (
      <>
        A <GlossaryTerm term="cliff" /> is a waiting period before anything can
        be claimed. When it passes, all tokens accrued so far unlock at once;
        the remaining allocation then continues to drip.
      </>
    ),
  },
  {
    title: "How to claim.",
    description: (
      <>
        Connect the recipient wallet, check the stream&apos;s progress, then
        choose <strong>Claim</strong> to withdraw available tokens. Stream
        schedules are retained in contract{" "}
        <GlossaryTerm term="persistent_storage">
          persistent storage
        </GlossaryTerm>
        ; your introduction is remembered on this device.
      </>
    ),
  },
];

export interface OnboardingModalProps {
  onDismiss: () => void;
}

export function OnboardingModal({ onDismiss }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const step = steps[currentStep]!;
  const isLastStep = currentStep === steps.length - 1;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      onDismiss();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <button
          type="button"
          className={styles.close}
          onClick={onDismiss}
          aria-label="Close onboarding"
        >
          ×
        </button>

        <div className={styles.stepCount} aria-live="polite">
          Step {currentStep + 1} of {steps.length}
        </div>
        <h2 id="onboarding-title" className={styles.title}>
          {step.title}
        </h2>

        <TokenFlowDiagram />

        <p id="onboarding-description" className={styles.description}>
          {step.description}
        </p>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.skip}
            onClick={onDismiss}
          >
            Skip introduction
          </button>
          <div className={styles.navigation}>
            {currentStep > 0 && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setCurrentStep((index) => index - 1)}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                if (isLastStep) onDismiss();
                else setCurrentStep((index) => index + 1);
              }}
            >
              {isLastStep ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function TokenFlowDiagram() {
  return (
    <figure className={styles.diagram}>
      <figcaption>How tokens flow through a vesting stream</figcaption>
      <svg
        viewBox="0 0 640 148"
        role="img"
        aria-label="Tokens are locked from the start until the cliff, unlock in a catch-up claim, then drip linearly until the end."
      >
        <line x1="42" y1="79" x2="598" y2="79" className={styles.track} />
        <line x1="42" y1="79" x2="250" y2="79" className={styles.lockedTrack} />
        <line x1="270" y1="79" x2="598" y2="79" className={styles.dripTrack} />
        <line x1="250" y1="44" x2="250" y2="111" className={styles.marker} />
        <line x1="42" y1="44" x2="42" y2="111" className={styles.marker} />
        <line x1="598" y1="44" x2="598" y2="111" className={styles.marker} />

        <text x="42" y="27" textAnchor="middle" className={styles.ledgerLabel}>
          start_ledger
        </text>
        <text x="250" y="27" textAnchor="middle" className={styles.ledgerLabel}>
          cliff_ledger
        </text>
        <text x="598" y="27" textAnchor="middle" className={styles.ledgerLabel}>
          end_ledger
        </text>
        <text x="130" y="105" textAnchor="middle" className={styles.flowLabel}>
          LOCKED
        </text>
        <text x="250" y="132" textAnchor="middle" className={styles.flowLabel}>
          CATCH-UP
        </text>
        <text x="438" y="105" textAnchor="middle" className={styles.flowLabel}>
          LINEAR DRIP
        </text>

        <circle cx="54" cy="79" r="6" className={styles.lockedToken} />
        <circle cx="54" cy="79" r="6" className={styles.lockedToken} />
        <circle cx="54" cy="79" r="6" className={styles.lockedToken} />
        <circle cx="282" cy="79" r="5" className={styles.dripToken} />
        <circle cx="282" cy="79" r="5" className={styles.dripToken} />
        <circle cx="282" cy="79" r="5" className={styles.dripToken} />
      </svg>
    </figure>
  );
}

export default OnboardingModal;
