import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OnboardingExperience } from "../OnboardingExperience";

describe("OnboardingExperience", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows the introduction once and persists dismissal", async () => {
    const { unmount } = render(<OnboardingExperience />);

    expect(
      await screen.findByRole("heading", { name: "What is a vesting stream?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close onboarding" }));

    await waitFor(() => {
      expect(localStorage.getItem("vesting_intro_complete")).toBe("true");
    });
    expect(
      screen.queryByRole("heading", { name: "What is a vesting stream?" }),
    ).not.toBeInTheDocument();

    unmount();
    render(<OnboardingExperience />);
    expect(
      screen.queryByRole("heading", { name: "What is a vesting stream?" }),
    ).not.toBeInTheDocument();
  });

  it("walks through three steps with a dismissible token-flow hero", async () => {
    render(<OnboardingExperience />);
    expect(await screen.findByText("Step 1 of 3")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: /tokens are locked from the start until the cliff/i,
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "What is a cliff?" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("heading", { name: "How to claim." }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => {
      expect(localStorage.getItem("vesting_intro_complete")).toBe("true");
    });
  });
});
