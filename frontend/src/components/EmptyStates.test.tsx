import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ExpiredFullyClaimedState,
  NewUserEmpty,
  NotificationsEmpty,
  SearchResultsEmpty,
  SponsorStreamListEmpty,
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
