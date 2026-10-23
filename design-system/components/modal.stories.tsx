import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect, userEvent } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/Modal",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Modal dialog with backdrop. Uses aria-modal, aria-labelledby for accessibility. " +
          "Focus should be trapped inside the modal while it is open.",
      },
    },
  },
};
export default meta;

export const CancelConfirm: StoryObj = {
  name: "Cancel Confirm",
  render: () => (
    <div className="ds-modal-backdrop" style={{ minHeight: 300 }}>
      <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-cancel">
        <div className="ds-modal__header" id="modal-title-cancel">Cancel stream?</div>
        <div className="ds-modal__body">
          Accrued tokens remain claimable by the recipient. The remaining balance is refunded to the sponsor.
        </div>
        <div className="ds-modal__footer">
          <button className="btn btn--secondary btn--sm">Keep stream</button>
          <button className="btn btn--danger btn--sm">Cancel stream</button>
        </div>
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("dialog")).toBeInTheDocument();
    expect(canvas.getByText("Cancel stream?")).toBeInTheDocument();
  },
};

export const ClaimConfirm: StoryObj = {
  name: "Claim Confirm",
  render: () => (
    <div className="ds-modal-backdrop" style={{ minHeight: 300 }}>
      <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-claim">
        <div className="ds-modal__header" id="modal-title-claim">Claim vested tokens</div>
        <div className="ds-modal__body">
          <p style={{ margin: "0 0 var(--space-4)" }}>
            You are about to claim your currently vested tokens.
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "var(--space-3)", background: "var(--color-bg-elevated)", borderRadius: "var(--radius-base)" }}>
            <span style={{ color: "var(--color-text-secondary)", fontSize: "var(--font-size-label)" }}>Claimable now</span>
            <span className="ds-amount-inline" style={{ color: "var(--color-success)", fontWeight: "var(--font-weight-bold)" }}>12 450 USDC</span>
          </div>
        </div>
        <div className="ds-modal__footer">
          <button className="btn btn--secondary btn--sm">Not now</button>
          <button className="btn btn--primary btn--sm">Claim 12 450 USDC</button>
        </div>
      </div>
    </div>
  ),
};

const ToggleModal = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn--primary" onClick={() => setOpen(true)}>
        Open Modal
      </button>
      {open && (
        <div className="ds-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title-interactive">
            <div className="ds-modal__header" id="modal-title-interactive">Interactive Modal</div>
            <div className="ds-modal__body">Click outside or press Close to dismiss.</div>
            <div className="ds-modal__footer">
              <button className="btn btn--secondary btn--sm" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const Interactive: StoryObj = {
  name: "Interactive",
  render: () => <ToggleModal />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const openBtn = canvas.getByText("Open Modal");
    await userEvent.click(openBtn);
    expect(canvas.getByRole("dialog")).toBeInTheDocument();
    const closeBtn = canvas.getByText("Close");
    await userEvent.click(closeBtn);
    expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
  },
};
