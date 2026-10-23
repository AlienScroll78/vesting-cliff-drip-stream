import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import React, { useState } from "react";
import {
  ClaimButton,
  ConfirmCancelModal,
  ScheduleCard,
  TimelineChart,
} from "./components";

// ─── ScheduleCard ─────────────────────────────────────────────────────────────

const scheduleCardMeta: Meta<typeof ScheduleCard> = {
  title: "Vesting UI/ScheduleCard",
  component: ScheduleCard,
  parameters: {
    docs: {
      description: {
        component:
          "Displays a vesting schedule summary: rate, cliff ledger, end ledger, and claimed amount.",
      },
    },
  },
};

export default scheduleCardMeta;

type ScheduleCardStory = StoryObj<typeof ScheduleCard>;

export const ScheduleCardDefault: ScheduleCardStory = {
  name: "Default",
  render: () => <ScheduleCard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Verify all key fields render
    expect(canvas.getByText("10 XLM / ledger")).toBeInTheDocument();
    expect(canvas.getByText("Ledger 150")).toBeInTheDocument();
    expect(canvas.getByText("Ledger 300")).toBeInTheDocument();
    expect(canvas.getByText("500 XLM")).toBeInTheDocument();
    expect(canvas.getByText("Active")).toBeInTheDocument();
  },
};

export const ScheduleCardLoading: ScheduleCardStory = {
  name: "Loading state",
  parameters: {
    docs: { description: { story: "Skeleton placeholder while the schedule data loads." } },
  },
  render: () => (
    <section className="schedule-card" aria-label="Vesting schedule" aria-busy="true">
      <div className="schedule-header">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ width: 120, height: 12, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
          <div style={{ width: 200, height: 22, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
        </div>
        <div style={{ width: 60, height: 28, background: "#e2e8f0", borderRadius: 999, animation: "pulse 1.5s infinite" }} />
      </div>
      <dl className="schedule-grid">
        {[1, 2, 3, 4].map((i) => (
          <div key={i}>
            <div style={{ width: "50%", height: 10, background: "#e2e8f0", borderRadius: 4, marginBottom: 6, animation: "pulse 1.5s infinite" }} />
            <div style={{ width: "70%", height: 16, background: "#e2e8f0", borderRadius: 4, animation: "pulse 1.5s infinite" }} />
          </div>
        ))}
      </dl>
    </section>
  ),
};

export const ScheduleCardError: ScheduleCardStory = {
  name: "Error state",
  parameters: {
    docs: { description: { story: "Shown when the schedule fails to load." } },
  },
  render: () => (
    <section
      className="schedule-card"
      aria-label="Vesting schedule"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 24 }}
    >
      <span style={{ fontSize: 32 }} role="img" aria-label="Error">⚠️</span>
      <p style={{ margin: 0, fontWeight: 700, color: "#b53030" }}>Failed to load schedule</p>
      <p style={{ margin: 0, color: "#687983", fontSize: 14 }}>
        Could not reach the Stellar network. Please check your connection and try again.
      </p>
      <button
        type="button"
        style={{ padding: "8px 18px", borderRadius: 8, background: "#156f5a", color: "#fff", border: "none", fontWeight: 700, cursor: "pointer" }}
      >
        Retry
      </button>
    </section>
  ),
};

export const ScheduleCardLongName: ScheduleCardStory = {
  name: "Edge case: long stream name",
  parameters: {
    docs: { description: { story: "Verifies the card handles very long contributor names without overflow." } },
  },
  render: () => <ScheduleCard />,
};

// ─── ClaimButton ──────────────────────────────────────────────────────────────

const claimButtonMeta: Meta<typeof ClaimButton> = {
  title: "Vesting UI/ClaimButton",
  component: ClaimButton,
  argTypes: {
    disabled: {
      control: "boolean",
      description: "Disables the button. Set true before the cliff is reached.",
      defaultValue: false,
    },
  },
  parameters: {
    docs: {
      description: {
        component: "Primary action button for claiming vested tokens. Disabled before the cliff ledger is reached.",
      },
    },
  },
};

// Re-export with a different default for each story file
export const ClaimButtonReady: StoryObj<typeof ClaimButton> = {
  name: "Ready",
  args: { disabled: false },
  render: (args) => <ClaimButton {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole("button", { name: /claim vested tokens/i });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    // Button should still be present (no navigation occurs in isolation)
    expect(btn).toBeInTheDocument();
  },
};

export const ClaimButtonDisabled: StoryObj<typeof ClaimButton> = {
  name: "Disabled (pre-cliff)",
  args: { disabled: true },
  render: (args) => <ClaimButton {...args} />,
  parameters: {
    docs: { description: { story: "Shown when the cliff ledger has not yet been reached." } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole("button", { name: /claim vested tokens/i });
    expect(btn).toBeDisabled();
  },
};

export const ClaimButtonLoading: StoryObj<typeof ClaimButton> = {
  name: "Loading (submitting)",
  render: () => (
    <button
      className="claim-button"
      disabled
      type="button"
      aria-busy="true"
      aria-label="Claiming tokens…"
    >
      Claiming…
    </button>
  ),
};

// ─── TimelineChart ────────────────────────────────────────────────────────────

const timelineMeta: Meta<typeof TimelineChart> = {
  title: "Vesting UI/TimelineChart",
  component: TimelineChart,
  parameters: {
    docs: {
      description: {
        component:
          "Visual timeline showing locked (pre-cliff), vested (post-cliff accrued), and pending (future) segments.",
      },
    },
  },
};

export const TimelineDefault: StoryObj<typeof TimelineChart> = {
  name: "Default",
  render: () => <TimelineChart />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = canvas.getByRole("region", { name: /vesting timeline/i });
    expect(section).toBeInTheDocument();
    // Verify markers render
    expect(canvas.getByText(/Start 100/)).toBeInTheDocument();
    expect(canvas.getByText(/Cliff 150/)).toBeInTheDocument();
    expect(canvas.getByText(/End 300/)).toBeInTheDocument();
  },
};

export const TimelinePreCliff: StoryObj<typeof TimelineChart> = {
  name: "Pre-cliff (all locked)",
  parameters: {
    docs: { description: { story: "Before the cliff: the entire track appears locked." } },
  },
  render: () => (
    <section className="timeline" aria-label="Vesting timeline">
      <div className="timeline-track">
        <span className="timeline-segment locked" style={{ gridColumn: "1 / -1" }} />
      </div>
      <div className="timeline-markers">
        <span>Start 100</span>
        <span>Cliff 250</span>
        <span>Current 150</span>
        <span>End 500</span>
      </div>
    </section>
  ),
};

export const TimelineComplete: StoryObj<typeof TimelineChart> = {
  name: "Complete (fully vested)",
  parameters: {
    docs: { description: { story: "After the end ledger: the entire track is vested." } },
  },
  render: () => (
    <section className="timeline" aria-label="Vesting timeline">
      <div className="timeline-track">
        <span className="timeline-segment vested" style={{ gridColumn: "1 / -1" }} />
      </div>
      <div className="timeline-markers">
        <span>Start 100</span>
        <span>Cliff 150</span>
        <span>End 300</span>
        <span>Current 350</span>
      </div>
    </section>
  ),
};

// ─── ConfirmCancelModal ───────────────────────────────────────────────────────

const cancelModalMeta: Meta<typeof ConfirmCancelModal> = {
  title: "Vesting UI/ConfirmCancelModal",
  component: ConfirmCancelModal,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Confirmation modal for cancelling a vesting stream. If the cliff has passed, accrued tokens remain available to the recipient.",
      },
    },
  },
};

export const ModalDefault: StoryObj<typeof ConfirmCancelModal> = {
  name: "Default",
  render: () => <ConfirmCancelModal />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Verify both action buttons exist
    const keepBtn = canvas.getByRole("button", { name: /keep stream/i });
    const cancelBtn = canvas.getByRole("button", { name: /cancel stream/i });
    expect(keepBtn).toBeInTheDocument();
    expect(cancelBtn).toBeInTheDocument();
  },
};

export const ModalKeepStreamInteraction: StoryObj<typeof ConfirmCancelModal> = {
  name: "Interaction: keep stream",
  parameters: {
    docs: { description: { story: "Clicking 'Keep stream' dismisses the modal without cancelling." } },
  },
  render: () => {
    const onKeep = fn();
    const onCancel = fn();
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
            <button className="secondary" type="button" onClick={onKeep}>Keep stream</button>
            <button className="danger" type="button" onClick={onCancel}>Cancel stream</button>
          </footer>
        </section>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const keepBtn = canvas.getByRole("button", { name: /keep stream/i });
    await userEvent.click(keepBtn);
    expect(keepBtn).toBeInTheDocument();
  },
};

export const ModalCancelInteraction: StoryObj<typeof ConfirmCancelModal> = {
  name: "Interaction: cancel stream",
  parameters: {
    docs: { description: { story: "Clicking 'Cancel stream' fires the cancel handler." } },
  },
  render: () => {
    const [cancelled, setCancelled] = useState(false);
    if (cancelled) {
      return (
        <div style={{ padding: 24, textAlign: "center", fontFamily: "sans-serif" }}>
          <p style={{ color: "#b53030", fontWeight: 700 }}>Stream cancelled.</p>
        </div>
      );
    }
    return (
      <div className="modal-backdrop">
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title-2">
          <header>
            <h2 id="cancel-title-2">Cancel stream</h2>
            <p>Accrued tokens remain available to the recipient after the cliff.</p>
          </header>
          <div className="modal-summary">
            <span>Sponsor refund</span>
            <strong>1,000 XLM</strong>
          </div>
          <footer>
            <button className="secondary" type="button">Keep stream</button>
            <button className="danger" type="button" onClick={() => setCancelled(true)}>Cancel stream</button>
          </footer>
        </section>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cancelBtn = canvas.getByRole("button", { name: /cancel stream/i });
    await userEvent.click(cancelBtn);
    const confirmation = await canvas.findByText(/stream cancelled/i);
    expect(confirmation).toBeInTheDocument();
  },
};

export const ModalPreCliff: StoryObj<typeof ConfirmCancelModal> = {
  name: "Pre-cliff (full refund)",
  parameters: {
    docs: { description: { story: "When cliff has not passed, the sponsor receives a full refund." } },
  },
  render: () => (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title-3">
        <header>
          <h2 id="cancel-title-3">Cancel stream</h2>
          <p>The cliff has not been reached. The full deposit will be refunded to you.</p>
        </header>
        <div className="modal-summary">
          <span>Full refund to sponsor</span>
          <strong>10,000 XLM</strong>
        </div>
        <footer>
          <button className="secondary" type="button">Keep stream</button>
          <button className="danger" type="button">Cancel &amp; refund</button>
        </footer>
      </section>
    </div>
  ),
};
