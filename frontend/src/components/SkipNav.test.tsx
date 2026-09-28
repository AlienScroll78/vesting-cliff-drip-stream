/**
 * Tests for SkipNav component (#389)
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SkipNav } from "./SkipNav";

describe("SkipNav", () => {
  it("renders a link with the correct href", () => {
    render(<SkipNav />);
    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("#main-content");
  });

  it("has the skip-nav CSS class for styling", () => {
    render(<SkipNav />);
    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link.className).toContain("skip-nav");
  });

  it("has accessible text visible to screen readers", () => {
    render(<SkipNav />);
    // getByRole with name ensures the text content is accessible
    expect(screen.getByRole("link", { name: "Skip to main content" })).toBeDefined();
  });
});
