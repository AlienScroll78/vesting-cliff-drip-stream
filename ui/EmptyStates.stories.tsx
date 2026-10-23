import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import {
  EventHistoryEmpty,
  ExpiredFullyClaimedState,
  NewUserEmpty,
  NotificationsEmpty,
  RecipientEmpty,
  SearchEmpty,
  SearchResultsEmpty,
  SponsorEmpty,
  SponsorStreamListEmpty,
  WalletNotConnectedEmpty,
} from "../frontend/src/components/EmptyStates";

const meta: Meta = {
  title: "Components/Empty states",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Accessible empty and completion states for streams, sponsors, notifications, and address searches.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

const address = "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678";

export const NewUser: Story = {
  name: "New user / no streams",
  args: { address },
  render: (args) => <NewUserEmpty {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("heading", { name: "You have no vesting streams yet. Ask your sponsor to create one." }),
    ).toBeInTheDocument();
    expect(canvas.getByRole("img", { name: /address card with a share arrow/i })).toBeInTheDocument();
    expect(canvas.getByRole("button", { name: "Share your address" })).toBeEnabled();
  },
};

export const Sponsor: Story = {
  name: "Sponsor / no streams",
  args: { onCreateStream: fn() },
  render: (args) => <SponsorStreamListEmpty {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("heading", { name: "Start rewarding your team with vesting" })).toBeInTheDocument();
    expect(canvas.getByRole("img", { name: /person beside a growing plant/i })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Create Stream" }));
  },
};

export const Notifications: Story = {
  name: "No notifications",
  render: () => <NotificationsEmpty />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("heading", { name: "All caught up! We'll notify you when something happens." }),
    ).toBeInTheDocument();
    expect(canvas.getByRole("img", { name: /bell with a check mark/i })).toBeInTheDocument();
  },
};

export const SearchResults: Story = {
  name: "No search results",
  args: { address },
  render: (args) => <SearchResultsEmpty {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("heading", { name: "No streams found for this address. Double-check the address or try a different one." }),
    ).toBeInTheDocument();
    expect(canvas.getByRole("link", { name: "Try another address" })).toHaveAttribute("href", "/");
    expect(canvas.getByRole("img", { name: /magnifying glass/i })).toBeInTheDocument();
  },
};

export const Completed: Story = {
  name: "Expired and fully claimed",
  args: { token: "USDC", totalReceived: 63_072_000, recipient: address, celebrate: true },
  render: (args) => <ExpiredFullyClaimedState {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("heading", { name: "Stream complete" })).toBeInTheDocument();
    expect(canvas.getByTestId("completed-total-received")).toHaveTextContent("63,072,000 USDC");
    expect(canvas.getByRole("img", { name: /trophy with stars and tokens/i })).toBeInTheDocument();
  },
};

// ─── 5 new scenarios ──────────────────────────────────────────────────────────

export const RecipientNoStreams: Story = {
  name: "Recipient / no active streams",
  render: () => <RecipientEmpty />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("heading", { name: "You have no active streams." }),
    ).toBeInTheDocument();
    expect(canvas.getByText(/Share your address with a sponsor to get started/i)).toBeInTheDocument();
    expect(
      canvas.getByRole("img", { name: /inbox with no streams/i }),
    ).toBeInTheDocument();
  },
};

export const SponsorNoStreams: Story = {
  name: "Sponsor / no streams created",
  args: { onCreateStream: fn() },
  render: (args) => <SponsorEmpty {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("heading", { name: "No vesting streams yet." }),
    ).toBeInTheDocument();
    expect(
      canvas.getByRole("button", { name: "Create your first vesting stream" }),
    ).toBeEnabled();
    expect(
      canvas.getByRole("img", { name: /rocket launching/i }),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Create your first vesting stream" }));
  },
};

export const EventHistoryNew: Story = {
  name: "Stream event history / just created",
  render: () => <EventHistoryEmpty />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("heading", {
        name: "Stream just created — events will appear as activity occurs.",
      }),
    ).toBeInTheDocument();
    expect(
      canvas.getByRole("img", { name: /timeline with a clock/i }),
    ).toBeInTheDocument();
  },
};

export const SearchNoResults: Story = {
  name: "Search / no filter results",
  args: { onClearFilters: fn() },
  render: (args) => <SearchEmpty {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("heading", { name: "No streams match your filters." }),
    ).toBeInTheDocument();
    expect(
      canvas.getByRole("button", { name: "Clear filters" }),
    ).toBeEnabled();
    expect(
      canvas.getByRole("img", { name: /magnifying glass overlapping a filter funnel/i }),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }));
  },
};

export const WalletNotConnected: Story = {
  name: "Wallet not connected",
  args: { onConnect: fn() },
  render: (args) => <WalletNotConnectedEmpty {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("heading", { name: "Connect your wallet to view your streams." }),
    ).toBeInTheDocument();
    expect(
      canvas.getByRole("button", { name: "Connect wallet" }),
    ).toBeEnabled();
    expect(
      canvas.getByRole("img", { name: /wallet with a lock/i }),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Connect wallet" }));
  },
};
