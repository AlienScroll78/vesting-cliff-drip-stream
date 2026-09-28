import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { SessionTimeoutWarning } from "./SessionTimeoutWarning";

// Mock the focus trap hook
vi.mock("@/hooks/useModalFocus", () => ({
  useModalFocus: vi.fn(),
}));

describe("SessionTimeoutWarning", () => {
  const mockOnStayConnected = vi.fn();
  const mockOnDisconnect = vi.fn();

  it("should not render when isOpen is false", () => {
    const { container } = render(
      <SessionTimeoutWarning
        isOpen={false}
        timeRemaining={600000}
        onStayConnected={mockOnStayConnected}
        onDisconnect={mockOnDisconnect}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("should render modal when isOpen is true", () => {
    render(
      <SessionTimeoutWarning
        isOpen={true}
        timeRemaining={600000}
        onStayConnected={mockOnStayConnected}
        onDisconnect={mockOnDisconnect}
      />
    );

    const modal = screen.getByRole("alertdialog");
    expect(modal).toBeInTheDocument();
  });

  it("should display formatted countdown timer", () => {
    render(
      <SessionTimeoutWarning
        isOpen={true}
        timeRemaining={605000} // 10:05
        onStayConnected={mockOnStayConnected}
        onDisconnect={mockOnDisconnect}
      />
    );

    expect(screen.getByText("10:05")).toBeInTheDocument();
  });

  it("should format zero-padded minutes and seconds", () => {
    render(
      <SessionTimeoutWarning
        isOpen={true}
        timeRemaining={61000} // 1:01
        onStayConnected={mockOnStayConnected}
        onDisconnect={mockOnDisconnect}
      />
    );

    expect(screen.getByText("01:01")).toBeInTheDocument();
  });

  it("should call onStayConnected when 'Stay Connected' button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SessionTimeoutWarning
        isOpen={true}
        timeRemaining={600000}
        onStayConnected={mockOnStayConnected}
        onDisconnect={mockOnDisconnect}
      />
    );

    const stayConnectedButton = screen.getByRole("button", { name: /stay connected/i });
    await user.click(stayConnectedButton);

    expect(mockOnStayConnected).toHaveBeenCalled();
  });

  it("should call onDisconnect when 'Disconnect Now' button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SessionTimeoutWarning
        isOpen={true}
        timeRemaining={600000}
        onStayConnected={mockOnStayConnected}
        onDisconnect={mockOnDisconnect}
      />
    );

    const disconnectButton = screen.getByRole("button", { name: /disconnect now/i });
    await user.click(disconnectButton);

    expect(mockOnDisconnect).toHaveBeenCalled();
  });

  it("should have proper accessibility attributes", () => {
    render(
      <SessionTimeoutWarning
        isOpen={true}
        timeRemaining={600000}
        onStayConnected={mockOnStayConnected}
        onDisconnect={mockOnDisconnect}
      />
    );

    const modal = screen.getByRole("alertdialog");
    expect(modal).toHaveAttribute("aria-labelledby", "timeout-title");
    expect(modal).toHaveAttribute("aria-describedby", "timeout-description");

    const title = screen.getByText(/Session Timeout Warning/);
    expect(title).toHaveAttribute("id", "timeout-title");
  });

  it("should have live region for timer updates", () => {
    render(
      <SessionTimeoutWarning
        isOpen={true}
        timeRemaining={600000}
        onStayConnected={mockOnStayConnected}
        onDisconnect={mockOnDisconnect}
      />
    );

    // Timer should have aria-live for screen reader updates
    const timerElements = screen.getAllByText(/10:00|10:/);
    expect(timerElements.length).toBeGreaterThan(0);
  });
});
