import React from "react";

export function ScheduleCard() {
  return (
    <section className="schedule-card" aria-label="Vesting schedule">
      <div className="schedule-header">
        <div>
          <p className="label">Contributor stream</p>
          <h2>Core Protocol Grant</h2>
        </div>
        <span className="status">Active</span>
      </div>
      <dl className="schedule-grid">
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
    <button className="claim-button" disabled={disabled} type="button">
      Claim vested tokens
    </button>
  );
}

export function TimelineChart() {
  return (
    <section className="timeline" aria-label="Vesting timeline">
      <div className="timeline-track">
        <span className="timeline-segment locked" />
        <span className="timeline-segment vested" />
        <span className="timeline-segment pending" />
      </div>
      <div className="timeline-markers">
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
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
        <header>
          <h2 id="cancel-title">Cancel stream</h2>
          <p>Accrued tokens remain available to the recipient after the cliff.</p>
        </header>
        <div className="modal-summary">
          <span>Sponsor refund</span>
          <strong>1,000 XLM</strong>
        </div>
        <footer>
          <button className="secondary" type="button">Keep stream</button>
          <button className="danger" type="button">Cancel stream</button>
        </footer>
      </section>
    </div>
  );
}
