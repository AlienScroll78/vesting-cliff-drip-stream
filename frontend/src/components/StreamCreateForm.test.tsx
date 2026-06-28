import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StreamCreateForm } from "@/components/StreamCreateForm";

const VALID_ADDRESS = "GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3BGMQSB3A";

describe("StreamCreateForm", () => {
  // ── Field validation on blur ──────────────────────────────────────────────

  it("shows error for empty recipient on blur", async () => {
    render(<StreamCreateForm />);
    const input = screen.getByLabelText(/recipient address/i);
    await userEvent.click(input);
    await userEvent.tab();
    expect(await screen.findByTestId("recipient-error")).toHaveTextContent(/required/i);
  });

  it("shows error for invalid Stellar address", async () => {
    render(<StreamCreateForm />);
    const input = screen.getByLabelText(/recipient address/i);
    await userEvent.type(input, "notanaddress");
    await userEvent.tab();
    expect(await screen.findByTestId("recipient-error")).toHaveTextContent(/valid stellar address/i);
  });

  it("clears recipient error when valid address entered", async () => {
    render(<StreamCreateForm />);
    const input = screen.getByLabelText(/recipient address/i);
    await userEvent.type(input, "bad");
    await userEvent.tab();
    expect(await screen.findByTestId("recipient-error")).toBeInTheDocument();
    // Simulate re-entering a valid address by clearing and typing valid one
    await userEvent.clear(input);
    await userEvent.type(input, VALID_ADDRESS);
    await userEvent.tab(); // trigger blur to re-run validation
    // Error should be gone because address is now valid
    await waitFor(() => expect(screen.queryByTestId("recipient-error")).not.toBeInTheDocument());
  });

  it("shows error when rate is 0", async () => {
    render(<StreamCreateForm />);
    const input = screen.getByLabelText(/rate/i);
    await userEvent.type(input, "0");
    await userEvent.tab();
    expect(await screen.findByTestId("rate-error")).toHaveTextContent(/positive integer/i);
  });

  it("shows error when rate is negative", async () => {
    render(<StreamCreateForm />);
    const input = screen.getByLabelText(/rate/i);
    await userEvent.type(input, "-5");
    await userEvent.tab();
    expect(await screen.findByTestId("rate-error")).toHaveTextContent(/positive integer/i);
  });

  it("shows error when total duration <= cliff duration (contract error #3)", async () => {
    render(<StreamCreateForm />);
    await userEvent.type(screen.getByLabelText(/cliff duration/i), "100");
    await userEvent.tab();
    await userEvent.type(screen.getByLabelText(/total duration/i), "100");
    await userEvent.tab();
    expect(await screen.findByTestId("totalDuration-error")).toHaveTextContent(
      /greater than cliff/i
    );
  });

  it("clears totalDuration error when total > cliff", async () => {
    render(<StreamCreateForm />);
    const cliffInput = screen.getByLabelText(/cliff duration/i);
    const totalInput = screen.getByLabelText(/total duration/i);
    await userEvent.type(cliffInput, "100");
    await userEvent.tab();
    await userEvent.type(totalInput, "50");
    await userEvent.tab();
    expect(await screen.findByTestId("totalDuration-error")).toBeInTheDocument();
    await userEvent.clear(totalInput);
    await userEvent.type(totalInput, "200");
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByTestId("totalDuration-error")).not.toBeInTheDocument());
  });

  // ── Submit button state ───────────────────────────────────────────────────

  it("submit button is not disabled before any interaction", () => {
    render(<StreamCreateForm />);
    const btn = screen.getByTestId("stream-create-submit");
    // Untouched form: button should not be HTML disabled (no fields touched yet)
    expect(btn).not.toBeDisabled();
  });

  it("calls onSubmit with form values when form is valid", async () => {
    const onSubmit = vi.fn();
    render(<StreamCreateForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/recipient address/i), VALID_ADDRESS);
    await userEvent.tab();
    await userEvent.type(screen.getByLabelText(/rate/i), "10");
    await userEvent.tab();
    await userEvent.type(screen.getByLabelText(/cliff duration/i), "17280");
    await userEvent.tab();
    await userEvent.type(screen.getByLabelText(/total duration/i), "172800");
    await userEvent.tab(); // blur last field so it's touched and valid
    await userEvent.click(screen.getByTestId("stream-create-submit"));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      recipient: VALID_ADDRESS,
      rate: "10",
      cliffDuration: "17280",
      totalDuration: "172800",
    });
  });

  it("does not call onSubmit when form is invalid", async () => {
    const onSubmit = vi.fn();
    render(<StreamCreateForm onSubmit={onSubmit} />);
    await userEvent.click(screen.getByTestId("stream-create-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces all errors when submit is clicked with empty form", async () => {
    render(<StreamCreateForm />);
    await userEvent.click(screen.getByTestId("stream-create-submit"));
    expect(await screen.findByTestId("recipient-error")).toBeInTheDocument();
    expect(await screen.findByTestId("rate-error")).toBeInTheDocument();
    expect(await screen.findByTestId("cliffDuration-error")).toBeInTheDocument();
    expect(await screen.findByTestId("totalDuration-error")).toBeInTheDocument();
  });
});
