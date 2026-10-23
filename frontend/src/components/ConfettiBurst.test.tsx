import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfettiBurst } from "@/components/ConfettiBurst";

describe("ConfettiBurst", () => {
  it("provides an accessible control to dismiss an active celebration", () => {
    const onDismiss = vi.fn();
    render(<ConfettiBurst active onDone={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss celebration" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not show a celebration or dismiss control when inactive", () => {
    const { container } = render(<ConfettiBurst active={false} onDone={vi.fn()} />);
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss celebration" })).not.toBeInTheDocument();
  });
});
