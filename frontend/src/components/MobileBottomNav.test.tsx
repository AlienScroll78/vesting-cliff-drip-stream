/**
 * Tests for MobileBottomNav (#279)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileBottomNav } from "./MobileBottomNav";
import { NotificationProvider } from "@/contexts/NotificationContext";

function renderNav(props: React.ComponentProps<typeof MobileBottomNav> = {}) {
  return render(
    <NotificationProvider>
      <MobileBottomNav {...props} />
    </NotificationProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MobileBottomNav (#279)", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    localStorage.clear();
  });

  it("renders the nav landmark", () => {
    renderNav();
    expect(screen.getByRole("navigation", { name: /Mobile navigation/i })).toBeInTheDocument();
  });

  it("renders all four primary tabs", () => {
    renderNav();
    expect(screen.getByTestId("mobile-nav-streams")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-nav-create")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-nav-activity")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-nav-settings")).toBeInTheDocument();
  });

  it("marks Streams as current on the dashboard route", () => {
    window.history.replaceState({}, "", "/dashboard");
    renderNav();
    expect(screen.getByTestId("mobile-nav-streams")).toHaveAttribute("aria-current", "page");
  });

  it("marks Activity as current when pathname starts with '/history'", () => {
    window.history.replaceState({}, "", "/history");
    renderNav();
    expect(screen.getByTestId("mobile-nav-activity")).toHaveAttribute("aria-current", "page");
  });

  it("marks Settings as current on the notification preferences route", () => {
    window.history.replaceState({}, "", "/notifications");
    renderNav();
    expect(screen.getByTestId("mobile-nav-settings")).toHaveAttribute("aria-current", "page");
  });

  it("shows the unread claim-available notification count on Streams", () => {
    localStorage.setItem("vesting_notifications", JSON.stringify([
      { id: "claim-1", type: "claim_available", read: false },
      { id: "claim-2", type: "claim_available", read: false },
      { id: "other-1", type: "cliff_reached", read: false },
      { id: "claim-3", type: "claim_available", read: true },
    ]));
    renderNav();
    expect(screen.getByTestId("mobile-nav-claimable-badge")).toHaveTextContent("2");
    expect(screen.getByTestId("mobile-nav-claimable-badge")).toHaveAccessibleName(
      "2 new claimable tokens"
    );
  });

  it("does not render a claimable badge when there are no unread claim notifications", () => {
    renderNav();
    expect(screen.queryByTestId("mobile-nav-claimable-badge")).not.toBeInTheDocument();
  });

  it("calls onCreateStream when Create tab is clicked", async () => {
    const onCreateStream = vi.fn();
    renderNav({ onCreateStream });
    await userEvent.click(screen.getByTestId("mobile-nav-create"));
    expect(onCreateStream).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the create-stream wizard when no create handler is supplied", async () => {
    renderNav();
    await userEvent.click(screen.getByTestId("mobile-nav-create"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("calls onSettings when Settings tab is clicked", async () => {
    const onSettings = vi.fn();
    renderNav({ onSettings });
    await userEvent.click(screen.getByTestId("mobile-nav-settings"));
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("links Settings to notification preferences without a custom handler", () => {
    renderNav();
    expect(screen.getByTestId("mobile-nav-settings")).toHaveAttribute("href", "/notifications");
  });

  it("links Streams and Activity to their existing pages", () => {
    renderNav();
    expect(screen.getByTestId("mobile-nav-streams")).toHaveAttribute("href", "/dashboard");
    expect(screen.getByTestId("mobile-nav-activity")).toHaveAttribute("href", "/history");
  });

  it("each tab has an accessible aria-label", () => {
    renderNav();
    expect(screen.getByLabelText(/Streams/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Create new stream/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Activity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Open settings/i)).toBeInTheDocument();
  });

  it("opens quick actions with claim and cancel destinations", async () => {
    renderNav();
    await userEvent.click(screen.getByTestId("mobile-quick-actions-button"));
    expect(screen.getByRole("dialog", { name: "Quick actions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Claim tokens/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /Cancel a stream/ })).toHaveAttribute("href", "/sponsor");
  });

  it("closes quick actions with Escape", async () => {
    renderNav();
    await userEvent.click(screen.getByTestId("mobile-quick-actions-button"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();
  });
});
