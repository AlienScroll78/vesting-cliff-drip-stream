import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  isExpiredAndFullyClaimed,
} from "./EmptyStates";

const address = "GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678";

function setNavigatorValue(name: string, value: unknown) {
  Object.defineProperty(navigator, name, { configurable: true, value });
}

describe("EmptyStates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setNavigatorValue("share", undefined);
    setNavigatorValue("clipboard", undefined);
  });

  it("shows the new-user copy and address CTA", () => {
    render(<NewUserEmpty address={address} />);

    expect(
      screen.getByRole("heading", { name: "You have no vesting streams yet. Ask your sponsor to create one." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask your sponsor/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share your address" })).toBeInTheDocument();
    expect(screen.getByText(address)).toBeInTheDocument();
  });

  it("shows the notification and search copy", () => {
    render(
      <>
        <NotificationsEmpty />
        <SearchResultsEmpty address={address} />
      </>,
    );

    expect(screen.getByRole("heading", { name: "All caught up! We'll notify you when something happens." })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No streams found for this address. Double-check the address or try a different one." }),
    ).toBeInTheDocument();
  });

  it("shows the sponsor copy and invokes the create callback", async () => {
    const onCreateStream = vi.fn();
    render(<SponsorStreamListEmpty onCreateStream={onCreateStream} />);

    expect(screen.getByRole("heading", { name: "Start rewarding your team with vesting" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create Stream" }));
    expect(onCreateStream).toHaveBeenCalledTimes(1);
  });

  it("uses Web Share when the browser supports it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorValue("share", share);
    setNavigatorValue("clipboard", { writeText });
    render(<NewUserEmpty address={address} />);

    await userEvent.click(screen.getByRole("button", { name: "Share your address" }));

    expect(share).toHaveBeenCalledWith({ title: "My vesting address", text: address });
    expect(writeText).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Address shared.");
  });

  it("falls back to the clipboard when Web Share is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigatorValue("share", undefined);
    setNavigatorValue("clipboard", { writeText });
    render(<NewUserEmpty address={address} />);

    await userEvent.click(screen.getByRole("button", { name: "Share your address" }));

    expect(writeText).toHaveBeenCalledWith(address);
    expect(await screen.findByRole("status")).toHaveTextContent("Address copied to your clipboard.");
  });

  it("renders distinct accessible illustrations for every state", () => {
    render(
      <>
        <NewUserEmpty address={address} />
        <SponsorStreamListEmpty />
        <NotificationsEmpty />
        <SearchResultsEmpty address={address} />
        <ExpiredFullyClaimedState token="USDC" totalReceived={1_000} />
      </>,
    );

    const illustrations = screen.getAllByRole("img");
    expect(illustrations).toHaveLength(5);
    expect(new Set(illustrations.map((node) => node.getAttribute("aria-label"))).size).toBe(5);
  });

  it("renders the completion state with the received token and amount", () => {
    render(<ExpiredFullyClaimedState token="USDC" totalReceived={63_072_000} recipient={address} />);

    expect(screen.getByRole("heading", { name: "Stream complete" })).toBeInTheDocument();
    expect(screen.getByText("Total received")).toBeInTheDocument();
    expect(screen.getByTestId("completed-total-received")).toHaveTextContent("63,072,000 USDC");
    expect(screen.getByText(/Every vested token has been claimed/i)).toBeInTheDocument();
  });
});

describe("isExpiredAndFullyClaimed", () => {
  it("requires an expired or terminal stream with a positive received amount", () => {
    expect(
      isExpiredAndFullyClaimed({
        status: "expired",
        claimableAmount: 0,
        totalReceived: 1_000,
      }),
    ).toBe(true);
    expect(
      isExpiredAndFullyClaimed({
        status: "active",
        currentLedger: 200,
        endLedger: 100,
        claimableAmount: 0,
        totalReceived: 1_000,
      }),
    ).toBe(true);
  });

  it("does not label merely expired or unclaimed streams as complete", () => {
    expect(
      isExpiredAndFullyClaimed({
        status: "expired",
        claimableAmount: 250,
        totalReceived: 750,
      }),
    ).toBe(false);
    expect(
      isExpiredAndFullyClaimed({
        status: "expired",
        claimableAmount: 0,
      }),
    ).toBe(false);
    expect(
      isExpiredAndFullyClaimed({
        status: "completed",
        claimableAmount: 0,
        totalReceived: 0,
      }),
    ).toBe(false);
  });
});

describe("RecipientEmpty", () => {
  it("shows exact required copy and illustration", () => {
    render(<RecipientEmpty />);
    expect(
      screen.getByRole("heading", { name: "You have no active streams." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Share your address with a sponsor to get started."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /inbox with no streams/i }),
    ).toBeInTheDocument();
  });

  it("uses the recipient-no-streams data-state", () => {
    const { container } = render(<RecipientEmpty />);
    expect(container.querySelector('[data-state="recipient-no-streams"]')).toBeTruthy();
  });
});

describe("SponsorEmpty", () => {
  it("shows exact required copy and illustration", () => {
    render(<SponsorEmpty />);
    expect(
      screen.getByRole("heading", { name: "No vesting streams yet." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /rocket launching/i }),
    ).toBeInTheDocument();
  });

  it("renders a 'Create your first vesting stream' CTA button", () => {
    render(<SponsorEmpty />);
    expect(
      screen.getByRole("link", { name: "Create your first vesting stream" }),
    ).toBeInTheDocument();
  });

  it("invokes the onCreateStream callback when provided", async () => {
    const onCreateStream = vi.fn();
    render(<SponsorEmpty onCreateStream={onCreateStream} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Create your first vesting stream" }),
    );
    expect(onCreateStream).toHaveBeenCalledTimes(1);
  });
});

describe("EventHistoryEmpty", () => {
  it("shows exact required copy and illustration", () => {
    render(<EventHistoryEmpty />);
    expect(
      screen.getByRole("heading", {
        name: "Stream just created — events will appear as activity occurs.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /timeline with a clock/i }),
    ).toBeInTheDocument();
  });

  it("uses the event-history-empty data-state", () => {
    const { container } = render(<EventHistoryEmpty />);
    expect(container.querySelector('[data-state="event-history-empty"]')).toBeTruthy();
  });
});

describe("SearchEmpty", () => {
  it("shows exact required copy and illustration", () => {
    render(<SearchEmpty />);
    expect(
      screen.getByRole("heading", { name: "No streams match your filters." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /magnifying glass overlapping a filter funnel/i }),
    ).toBeInTheDocument();
  });

  it("renders a 'Clear filters' button", () => {
    render(<SearchEmpty />);
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("invokes onClearFilters when the button is clicked", async () => {
    const onClearFilters = vi.fn();
    render(<SearchEmpty onClearFilters={onClearFilters} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });
});

describe("WalletNotConnectedEmpty", () => {
  it("shows exact required copy and illustration", () => {
    render(<WalletNotConnectedEmpty />);
    expect(
      screen.getByRole("heading", { name: "Connect your wallet to view your streams." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /wallet with a lock/i }),
    ).toBeInTheDocument();
  });

  it("renders a 'Connect wallet' CTA button", () => {
    render(<WalletNotConnectedEmpty />);
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
  });

  it("invokes onConnect when the button is clicked", async () => {
    const onConnect = vi.fn();
    render(<WalletNotConnectedEmpty onConnect={onConnect} />);
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
  });
});

describe("All 5 new empty states render distinct accessible illustrations", () => {
  it("each illustration has a unique accessible label", () => {
    render(
      <>
        <RecipientEmpty />
        <SponsorEmpty />
        <EventHistoryEmpty />
        <SearchEmpty />
        <WalletNotConnectedEmpty />
      </>,
    );

    const illustrations = screen.getAllByRole("img");
    // at minimum the 5 new ones exist (there may be more from other states)
    expect(illustrations.length).toBeGreaterThanOrEqual(5);
    const labels = illustrations.map((el) => el.getAttribute("aria-label") ?? "");
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});
