import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import React from "react";
import { StatusBadge, StatusLegend } from "../frontend/src/components/StatusBadge";
import type { StreamStatus } from "../frontend/src/types";

const meta: Meta<typeof StatusBadge> = {
  title: "Components/StatusBadge",
  component: StatusBadge,
  argTypes: {
    status: {
      control: "select",
      options: ["active", "pre-cliff", "completed", "cancelled"] satisfies StreamStatus[],
      description: "The current stream status.",
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Status badge for vesting stream states. Each state has a distinct colour and symbol for quick scanning. Uses aria-label for screen-reader clarity.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const Active: Story = {
  args: { status: "active" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const badge = canvas.getByRole("generic", { hidden: false });
    expect(badge).toHaveAttribute("aria-label", "Status: Active");
  },
};

export const PreCliff: Story = {
  name: "Pre-cliff",
  args: { status: "pre-cliff" },
  parameters: {
    docs: { description: { story: "Shown when the cliff ledger has not yet been reached." } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Just verify it renders without throwing
    expect(canvas.getByText(/Pre-cliff/i)).toBeInTheDocument();
  },
};

export const Completed: Story = {
  args: { status: "completed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/Completed/i)).toBeInTheDocument();
  },
};

export const Cancelled: Story = {
  args: { status: "cancelled" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/Cancelled/i)).toBeInTheDocument();
  },
};

export const AllStatuses: Story = {
  name: "All statuses",
  parameters: {
    docs: { description: { story: "All four stream statuses side by side." } },
  },
  render: () => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {(["active", "pre-cliff", "completed", "cancelled"] as StreamStatus[]).map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/Active/)).toBeInTheDocument();
    expect(canvas.getByText(/Pre-cliff/)).toBeInTheDocument();
    expect(canvas.getByText(/Completed/)).toBeInTheDocument();
    expect(canvas.getByText(/Cancelled/)).toBeInTheDocument();
  },
};

export const Legend: Story = {
  name: "Status legend",
  parameters: {
    docs: { description: { story: "The full legend component showing all statuses with labels." } },
  },
  render: () => <StatusLegend />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const legend = canvas.getByRole("note", { name: /stream status legend/i });
    expect(legend).toBeInTheDocument();
  },
};
