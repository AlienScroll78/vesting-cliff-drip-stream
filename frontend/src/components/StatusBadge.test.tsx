import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, StatusLegend } from "@/components/StatusBadge";

describe("StatusBadge", () => {
  it("renders active status with correct label", () => {
    render(<StatusBadge status="active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByLabelText("Status: Active")).toBeInTheDocument();
  });

  it("renders pre-cliff status with correct label", () => {
    render(<StatusBadge status="pre-cliff" />);
    expect(screen.getByText("Pre-cliff")).toBeInTheDocument();
    expect(screen.getByLabelText("Status: Pre-cliff")).toBeInTheDocument();
  });

  it("renders completed status with correct label", () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByLabelText("Status: Completed")).toBeInTheDocument();
  });

  it("renders cancelled status with correct label", () => {
    render(<StatusBadge status="cancelled" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByLabelText("Status: Cancelled")).toBeInTheDocument();
  });

  it("renders symbol for each status", () => {
    const { rerender } = render(<StatusBadge status="active" />);
    expect(screen.getByText("●")).toBeInTheDocument();

    rerender(<StatusBadge status="completed" />);
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("has correct CSS classes", () => {
    const { container } = render(<StatusBadge status="active" />);
    expect(container.querySelector(".badge-active")).toBeInTheDocument();

    const { container: container2 } = render(<StatusBadge status="cancelled" />);
    expect(container2.querySelector(".badge-cancelled")).toBeInTheDocument();
  });

  it("has correct aria-label for screen readers", () => {
    render(<StatusBadge status="pre-cliff" />);
    const badge = screen.getByLabelText("Status: Pre-cliff");
    expect(badge.tagName).toBe("SPAN");
  });

  it("symbol element is hidden from screen readers", () => {
    render(<StatusBadge status="active" />);
    const symbol = screen.getByText("●");
    expect(symbol).toHaveAttribute("aria-hidden", "true");
  });
});

describe("StatusLegend", () => {
  it("renders all four status badges", () => {
    render(<StatusLegend />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Pre-cliff")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("has legend header", () => {
    render(<StatusLegend />);
    expect(screen.getByText("Legend:")).toBeInTheDocument();
  });

  it("has correct aria role", () => {
    render(<StatusLegend />);
    expect(screen.getByLabelText("Stream status legend")).toBeInTheDocument();
  });
});
