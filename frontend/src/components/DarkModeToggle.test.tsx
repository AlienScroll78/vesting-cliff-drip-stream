import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DarkModeToggle } from "@/components/DarkModeToggle";

const STORAGE_KEY = "vesting-dark-mode";

function setSystemDark(dark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.theme;
  setSystemDark(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DarkModeToggle (#536)", () => {
  it("renders an accessible toggle in light mode", () => {
    render(<DarkModeToggle />);
    const button = screen.getByRole("button", { name: /switch to dark mode/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("switches to dark mode when clicked", async () => {
    const user = userEvent.setup();
    render(<DarkModeToggle />);

    await user.click(screen.getByRole("button", { name: /switch to dark mode/i }));

    const button = screen.getByRole("button", { name: /switch to light mode/i });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists the chosen preference to localStorage", async () => {
    const user = userEvent.setup();
    render(<DarkModeToggle />);

    await user.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("starts in dark mode when the stored preference is dark", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    render(<DarkModeToggle />);
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
