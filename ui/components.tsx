/**
 * Shared UI components — Issue #540: migrated to CSS Modules.
 *
 * Each component now uses locally-scoped class names from ./components.module.css
 * instead of global CSS class strings, eliminating specificity conflicts and
 * enabling reliable theming via CSS custom properties.
 */
import React from "react";
import styles from "./components.module.css";

export function ScheduleCard() {
  return (
    <section className={styles.scheduleCard} aria-label="Vesting schedule">
      <div className={styles.scheduleHeader}>
        <div>
          <p className={styles.scheduleLabel}>Contributor stream</p>
          <h2 className={styles.scheduleTitle}>Core Protocol Grant</h2>
        </div>
        <span className={styles.scheduleStatus}>Active</span>
      </div>
      <dl className={styles.scheduleGrid}>
        <div>
          <dt>Rate</dt>
          <dd>10 XLM / ledger</dd>
        </div>
        <div>
          <dt>Cliff</dt>
          <dd>Ledger 150</dd>
        </div>
        <div>
          <dt>End</dt>
          <dd>Ledger 300</dd>
        </div>
        <div>
          <dt>Claimed</dt>
          <dd>500 XLM</dd>
        </div>
      </dl>
    </section>
  );
}

export function ClaimButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <button className={styles.claimButton} disabled={disabled} type="button">
      Claim vested tokens
    </button>
  );
}

export function TimelineChart() {
  return (
    <section className={styles.timeline} aria-label="Vesting timeline">
      <div className={styles.timelineTrack}>
        <span className={styles.segmentLocked} />
        <span className={styles.segmentVested} />
        <span className={styles.segmentPending} />
      </div>
      <div className={styles.timelineMarkers}>
        <span>Start 100</span>
        <span>Cliff 150</span>
        <span>Current 200</span>
        <span>End 300</span>
      </div>
    </section>
  );
}

export function ConfirmCancelModal() {
  return (
    <div className={styles.modalBackdrop}>
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-title"
      >
        <header className={styles.modalHeader}>
          <h2 id="cancel-title" className={styles.modalTitle}>Cancel stream</h2>
          <p className={styles.modalSubtitle}>
            Accrued tokens remain available to the recipient after the cliff.
          </p>
        </header>
        <div className={styles.modalSummary}>
          <span>Sponsor refund</span>
          <strong>1,000 XLM</strong>
        </div>
        <footer className={styles.modalFooter}>
          <button className={styles.btnSecondary} type="button">Keep stream</button>
          <button className={styles.btnDanger} type="button">Cancel stream</button>
        </footer>
      </section>
    </div>
  );
}
