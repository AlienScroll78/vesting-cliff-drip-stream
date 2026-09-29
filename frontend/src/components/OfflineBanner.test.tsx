import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OfflineBanner } from "./OfflineBanner";

// Mock the hook
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: vi.fn(() => true),
}));

describe("OfflineBanner", () => {
  it("should not render when online", () => {
    const { useOnlineStatus } = require("@/hooks/useOnlineStatus");
    useOnlineStatus.mockReturnValue(true);

    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("should render when offline", () => {
    const { useOnlineStatus } = require("@/hooks/useOnlineStatus");
    useOnlineStatus.mockReturnValue(false);

    render(<OfflineBanner />);

    const banner = screen.getByRole("status");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("aria-label", "Application is currently offline");
  });

  it("should display offline message", () => {
    const { useOnlineStatus } = require("@/hooks/useOnlineStatus");
    useOnlineStatus.mockReturnValue(false);

    render(<OfflineBanner />);

    expect(screen.getByText(/You're offline/i)).toBeInTheDocument();
  });
});
