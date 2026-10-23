import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, expect, userEvent } from "@storybook/test";

const meta: Meta = {
  title: "Design System/Components/InlineFieldError",
  parameters: {
    docs: {
      description: {
        component:
          "Inline field error displayed below form inputs after validation failure. " +
          "Always paired with aria-describedby on the input to connect the message to the field. " +
          "Uses the ds-field-error CSS class. Animates in from above when an error first appears.",
      },
    },
  },
};
export default meta;

// ── Helpers ──────────────────────────────────────────────────────────────────
const ErrorIcon = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="12" height="12" aria-hidden="true" focusable="false">
    <circle cx="6" cy="6" r="5" />
    <path d="M6 3.5v3M6 8v.5" strokeLinecap="round" />
  </svg>
);

interface FieldErrorProps {
  id: string;
  message: string;
}

function InlineFieldError({ id, message }: FieldErrorProps) {
  return (
    <span id={id} className="ds-field-error" role="alert">
      <span className="ds-field-error__icon"><ErrorIcon /></span>
      <span className="ds-field-error__text">{message}</span>
    </span>
  );
}

// ── Field group helper for stories ──────────────────────────────────────────
interface FieldProps {
  label: string;
  inputType?: string;
  placeholder?: string;
  defaultValue?: string;
  errorMessage?: string;
}

function Field({ label, inputType = "text", placeholder, defaultValue, errorMessage }: FieldProps) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  const errorId = `${id}-error`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxWidth: "22rem" }}>
      <label
        htmlFor={id}
        style={{ fontSize: "var(--font-size-label)", fontWeight: "var(--font-weight-medium)", color: "var(--color-text-primary)" }}
      >
        {label}
      </label>
      <input
        id={id}
        type={inputType}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className={`input${errorMessage ? " input--error" : ""}`}
        aria-describedby={errorMessage ? errorId : undefined}
        aria-invalid={errorMessage ? "true" : undefined}
      />
      {errorMessage && <InlineFieldError id={errorId} message={errorMessage} />}
    </div>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

export const AllFieldErrors: StoryObj = {
  name: "All field errors",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", padding: "var(--space-6)" }}>
      <Field
        label="Recipient address"
        placeholder="G…"
        defaultValue="not-a-valid-address"
        errorMessage="Enter a valid Stellar public key (starts with G)."
      />
      <Field
        label="Token rate (per ledger)"
        inputType="number"
        defaultValue="-1"
        errorMessage="Rate must be greater than zero."
      />
      <Field
        label="Cliff duration (ledgers)"
        inputType="number"
        defaultValue="0"
        errorMessage="Cliff duration must be at least 1 ledger."
      />
      <Field
        label="Total duration (ledgers)"
        inputType="number"
        defaultValue="1000"
        errorMessage="Total duration must be longer than the cliff duration."
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(canvas.getByText("Rate must be greater than zero.")).toBeInTheDocument();
  },
};

export const RecipientAddressError: StoryObj = {
  name: "Recipient address — invalid",
  render: () => (
    <div style={{ padding: "var(--space-6)" }}>
      <Field
        label="Recipient address"
        placeholder="G…"
        defaultValue="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        errorMessage="This address matches the connected wallet. Sponsor and recipient must be different."
      />
    </div>
  ),
};

export const RateTooLow: StoryObj = {
  name: "Rate — below minimum deposit",
  render: () => (
    <div style={{ padding: "var(--space-6)" }}>
      <Field
        label="Token rate (per ledger)"
        inputType="number"
        defaultValue="1"
        errorMessage="Rate × duration is below the minimum deposit (100 tokens). Increase the rate or extend the duration."
      />
    </div>
  ),
};

export const MetadataTooLong: StoryObj = {
  name: "Metadata — too long",
  render: () => (
    <div style={{ padding: "var(--space-6)" }}>
      <Field
        label="Stream description"
        inputType="text"
        defaultValue={"A".repeat(260)}
        errorMessage="Description must be 256 characters or fewer. Currently 260 characters."
      />
    </div>
  ),
};

// ── Interactive validation example ──────────────────────────────────────────
export const LiveValidation: StoryObj = {
  name: "Live validation (interactive)",
  render: () => {
    const [rate, setRate] = useState("");
    const [touched, setTouched] = useState(false);
    const numRate = parseInt(rate, 10);
    const errorMsg =
      touched && (rate === "" || numRate <= 0)
        ? "Rate must be a whole number greater than zero."
        : null;

    return (
      <div style={{ padding: "var(--space-6)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxWidth: "22rem" }}>
          <label
            htmlFor="rate-live"
            style={{ fontSize: "var(--font-size-label)", fontWeight: "var(--font-weight-medium)", color: "var(--color-text-primary)" }}
          >
            Token rate (per ledger)
          </label>
          <input
            id="rate-live"
            type="number"
            min="1"
            placeholder="e.g. 10"
            className={`input${errorMsg ? " input--error" : ""}`}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-describedby={errorMsg ? "rate-live-error" : undefined}
            aria-invalid={errorMsg ? "true" : undefined}
          />
          {errorMsg && <InlineFieldError id="rate-live-error" message={errorMsg} />}
        </div>
        <p style={{ marginTop: "var(--space-4)", fontSize: "var(--font-size-caption)", color: "var(--color-text-secondary)" }}>
          Tab out of the field or clear the value to trigger validation.
        </p>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Token rate (per ledger)");
    // Type an invalid value then blur
    await userEvent.type(input, "-1");
    await userEvent.tab();
    expect(canvas.getByRole("alert")).toBeInTheDocument();
    // Fix the value
    await userEvent.clear(input);
    await userEvent.type(input, "10");
    expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const MultipleErrors: StoryObj = {
  name: "Multiple fields in error",
  render: () => (
    <div style={{ padding: "var(--space-6)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", maxWidth: "22rem" }}>
        <Field
          label="Cliff duration (ledgers)"
          inputType="number"
          defaultValue="50000"
          errorMessage="Cliff duration cannot exceed 80% of the total duration."
        />
        <Field
          label="Total duration (ledgers)"
          inputType="number"
          defaultValue="50000"
          errorMessage="Total duration must be longer than the cliff duration."
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "When multiple fields fail validation simultaneously, each gets its own inline error message " +
          "directly below the relevant input. Each carries its own role='alert' so screen readers " +
          "announce all errors on submit.",
      },
    },
  },
};
