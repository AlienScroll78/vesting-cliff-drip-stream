"use client";
import { useState, type ChangeEvent, type FocusEvent } from "react";

interface FormValues {
  recipient: string;
  rate: string;
  cliffDuration: string;
  totalDuration: string;
}

interface FormErrors {
  recipient?: string;
  rate?: string;
  cliffDuration?: string;
  totalDuration?: string;
}

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (!values.recipient) {
    errors.recipient = "Recipient address is required.";
  } else if (!STELLAR_ADDRESS_RE.test(values.recipient)) {
    errors.recipient = "Must be a valid Stellar address (G…, 56 chars).";
  }

  const rate = Number(values.rate);
  if (!values.rate) {
    errors.rate = "Rate is required.";
  } else if (!Number.isInteger(rate) || rate <= 0) {
    errors.rate = "Rate must be a positive integer (> 0).";
  }

  const cliff = Number(values.cliffDuration);
  const total = Number(values.totalDuration);

  if (!values.cliffDuration) {
    errors.cliffDuration = "Cliff duration is required.";
  } else if (!Number.isInteger(cliff) || cliff <= 0) {
    errors.cliffDuration = "Cliff duration must be a positive integer.";
  }

  if (!values.totalDuration) {
    errors.totalDuration = "Total duration is required.";
  } else if (!Number.isInteger(total) || total <= 0) {
    errors.totalDuration = "Total duration must be a positive integer.";
  } else if (values.cliffDuration && total <= cliff) {
    // Mirrors contract error #3 InvalidDuration
    errors.totalDuration = "Total duration must be greater than cliff duration.";
  }

  return errors;
}

interface Props {
  onSubmit?: (values: FormValues) => void;
}

export function StreamCreateForm({ onSubmit }: Props) {
  const [values, setValues] = useState<FormValues>({
    recipient: "",
    rate: "",
    cliffDuration: "",
    totalDuration: "",
  });
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});

  const errors = validate(values);
  const isValid = Object.keys(errors).length === 0;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleBlur(e: FocusEvent<HTMLInputElement>) {
    const { name } = e.target;
    setTouched((prev) => ({ ...prev, [name]: true }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Mark all fields as touched to surface all errors on submit attempt
    setTouched({ recipient: true, rate: true, cliffDuration: true, totalDuration: true });
    if (!isValid) return;
    onSubmit?.(values);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Create vesting stream"
      data-testid="stream-create-form"
      style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
    >
      <Field
        id="recipient"
        name="recipient"
        label="Recipient address"
        placeholder="G…"
        value={values.recipient}
        error={touched.recipient ? errors.recipient : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
      />

      <Field
        id="rate"
        name="rate"
        label="Rate (tokens per ledger)"
        placeholder="e.g. 10"
        type="number"
        min="1"
        step="1"
        value={values.rate}
        error={touched.rate ? errors.rate : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
      />

      <Field
        id="cliffDuration"
        name="cliffDuration"
        label="Cliff duration (ledgers)"
        placeholder="e.g. 17280"
        type="number"
        min="1"
        step="1"
        value={values.cliffDuration}
        error={touched.cliffDuration ? errors.cliffDuration : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
      />

      <Field
        id="totalDuration"
        name="totalDuration"
        label="Total duration (ledgers)"
        placeholder="e.g. 172800"
        type="number"
        min="1"
        step="1"
        value={values.totalDuration}
        error={touched.totalDuration ? errors.totalDuration : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
      />

      <button
        type="submit"
        className="btn btn-primary"
        disabled={Object.keys(touched).length > 0 && !isValid}
        data-testid="stream-create-submit"
        aria-disabled={Object.keys(touched).length > 0 && !isValid}
      >
        Create Stream
      </button>
    </form>
  );
}

// ── Field sub-component ───────────────────────────────────────────────────────

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
}

function Field({ id, label, error, ...inputProps }: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <label htmlFor={id} style={{ fontSize: "0.875rem", fontWeight: 600 }}>
        {label}
      </label>
      <input
        id={id}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={!!error}
        style={{
          padding: "0.5rem 0.75rem",
          border: `1px solid ${error ? "var(--color-cancelled, #b91c1c)" : "var(--color-border, #e5e7eb)"}`,
          borderRadius: "var(--radius, 0.5rem)",
          fontSize: "0.95rem",
          outline: "none",
        }}
        {...inputProps}
      />
      {error && (
        <span
          id={errorId}
          role="alert"
          data-testid={`${id}-error`}
          style={{ fontSize: "0.8rem", color: "var(--color-cancelled, #b91c1c)" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
