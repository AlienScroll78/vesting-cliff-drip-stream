"use client";
import { useState, type ChangeEvent, type FocusEvent } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { getErrorInfo } from "@/errorMessages";

// ~5 seconds per ledger on Stellar
const LEDGERS_PER_DAY = Math.round((24 * 60 * 60) / 5);

interface FormValues {
  recipient: string;
  token: string;
  rate: string;
  cliffDays: string;
  totalDays: string;
}

interface FormErrors {
  recipient?: string;
  token?: string;
  rate?: string;
  cliffDays?: string;
  totalDays?: string;
}

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (!values.recipient) {
    errors.recipient = "Recipient address is required.";
  } else if (!STELLAR_ADDRESS_RE.test(values.recipient)) {
    errors.recipient = "Must be a valid Stellar address (G…, 56 chars).";
  }

  if (!values.token) {
    errors.token = "Token contract address is required.";
  } else if (!CONTRACT_ADDRESS_RE.test(values.token)) {
    errors.token = "Must be a valid SAC contract address (C…, 56 chars).";
  }

  const rate = Number(values.rate);
  if (!values.rate) {
    errors.rate = "Rate is required.";
  } else if (!Number.isInteger(rate) || rate <= 0) {
    errors.rate = "Rate must be a positive integer (> 0).";
  }

  const cliff = Number(values.cliffDays);
  const total = Number(values.totalDays);

  if (!values.cliffDays) {
    errors.cliffDays = "Cliff duration is required.";
  } else if (isNaN(cliff) || cliff <= 0) {
    errors.cliffDays = "Cliff must be a positive number of days.";
  }

  if (!values.totalDays) {
    errors.totalDays = "Total duration is required.";
  } else if (isNaN(total) || total <= 0) {
    errors.totalDays = "Total duration must be positive.";
  } else if (values.cliffDays && total <= cliff) {
    errors.totalDays = "Total duration must be greater than cliff duration.";
  }

  return errors;
}

function daysToLedgers(days: number): number {
  return Math.round(days * LEDGERS_PER_DAY);
}

interface TxResult {
  hash: string;
}

// Stub — replace with real Soroban contract invocation via Freighter
async function submitCreateStream(_params: {
  sponsor: string;
  recipient: string;
  token: string;
  rate: number;
  cliffLedgers: number;
  totalLedgers: number;
}): Promise<TxResult> {
  await new Promise((r) => setTimeout(r, 1500));
  // Simulate random VestingError code 6 (ScheduleAlreadyExists) occasionally in dev
  // In production, parse the contract error from the Soroban response
  return { hash: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("") };
}

interface Props {
  onSuccess?: (hash: string) => void;
}

export function StreamCreateForm({ onSuccess }: Props) {
  const { address: sponsor } = useWallet();

  const [values, setValues] = useState<FormValues>({
    recipient: "",
    token: "",
    rate: "",
    cliffDays: "",
    totalDays: "",
  });
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [contractError, setContractError] = useState<number | null>(null);

  const errors = validate(values);
  const hasErrors = Object.keys(errors).length > 0;
  const isTouched = Object.keys(touched).length > 0;

  // Computed deposit preview
  const rate = Number(values.rate);
  const totalDays = Number(values.totalDays);
  const cliffDays = Number(values.cliffDays);
  const cliffLedgers = cliffDays > 0 ? daysToLedgers(cliffDays) : 0;
  const totalLedgers = totalDays > 0 ? daysToLedgers(totalDays) : 0;
  const estimatedDeposit = rate > 0 && totalLedgers > 0 ? rate * totalLedgers : null;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    setTxHash(null);
    setContractError(null);
  }

  function handleBlur(e: FocusEvent<HTMLInputElement>) {
    setTouched((prev) => ({ ...prev, [e.target.name]: true }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ recipient: true, token: true, rate: true, cliffDays: true, totalDays: true });
    if (hasErrors || !sponsor) return;
    setSubmitting(true);
    setContractError(null);
    try {
      const result = await submitCreateStream({
        sponsor,
        recipient: values.recipient,
        token: values.token,
        rate,
        cliffLedgers,
        totalLedgers,
      });
      setTxHash(result.hash);
      onSuccess?.(result.hash);
    } catch (err) {
      // Parse VestingError code from contract error message
      const msg = err instanceof Error ? err.message : "";
      const match = /code[:\s]+(\d+)/i.exec(msg) ?? /error[:\s]+(\d+)/i.exec(msg);
      setContractError(match ? Number(match[1]) : 0);
    } finally {
      setSubmitting(false);
    }
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
        id="token"
        name="token"
        label="Token contract (SAC)"
        placeholder="C…"
        value={values.token}
        error={touched.token ? errors.token : undefined}
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
        id="cliffDays"
        name="cliffDays"
        label="Cliff duration (days)"
        placeholder="e.g. 30"
        type="number"
        min="0.001"
        step="any"
        value={values.cliffDays}
        error={touched.cliffDays ? errors.cliffDays : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
        hint={cliffDays > 0 ? `≈ ${cliffLedgers.toLocaleString()} ledgers` : undefined}
      />

      <Field
        id="totalDays"
        name="totalDays"
        label="Total duration (days)"
        placeholder="e.g. 365"
        type="number"
        min="0.001"
        step="any"
        value={values.totalDays}
        error={touched.totalDays ? errors.totalDays : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
        hint={totalDays > 0 ? `≈ ${totalLedgers.toLocaleString()} ledgers` : undefined}
      />

      {/* Deposit preview */}
      {estimatedDeposit !== null && !hasErrors && (
        <div
          role="status"
          aria-live="polite"
          data-testid="deposit-preview"
          style={{
            padding: "0.75rem 1rem",
            background: "#eff6ff",
            border: "1px solid var(--color-active)",
            borderRadius: "var(--radius)",
            fontSize: "0.875rem",
          }}
        >
          <strong>Estimated total deposit:</strong>{" "}
          {estimatedDeposit.toLocaleString()} tokens
          <span style={{ color: "#6b7280", marginLeft: "0.5rem" }}>
            ({rate} tokens/ledger × {totalLedgers.toLocaleString()} ledgers)
          </span>
        </div>
      )}

      {!sponsor && (
        <p style={{ fontSize: "0.875rem", color: "var(--color-cancelled)" }} role="alert">
          Connect your wallet to create a stream.
        </p>
      )}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={submitting || !sponsor}
        data-testid="stream-create-submit"
        aria-busy={submitting}
      >
        {submitting ? "Creating…" : "Create Stream"}
      </button>

      {/* Success */}
      {txHash && (
        <div
          role="status"
          data-testid="tx-success"
          style={{
            padding: "0.75rem 1rem",
            background: "#f0fdf4",
            border: "1px solid var(--color-completed)",
            borderRadius: "var(--radius)",
            fontSize: "0.875rem",
          }}
        >
          <strong style={{ color: "var(--color-completed)" }}>✓ Stream created!</strong>
          <div style={{ marginTop: "0.35rem" }}>
            Tx:{" "}
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontFamily: "monospace", wordBreak: "break-all", color: "var(--color-active)" }}
              aria-label={`View transaction ${txHash} on Stellar Expert`}
            >
              {txHash}
            </a>
          </div>
        </div>
      )}

      {/* Contract error */}
      {contractError !== null && !txHash && (
        <div
          role="alert"
          data-testid="contract-error"
          style={{
            padding: "0.75rem 1rem",
            background: "#fef2f2",
            border: "1px solid var(--color-cancelled)",
            borderRadius: "var(--radius)",
            fontSize: "0.875rem",
          }}
        >
          {(() => {
            const info = getErrorInfo(contractError);
            return (
              <>
                <strong style={{ color: "var(--color-cancelled)" }}>{info.title}</strong>
                <p style={{ margin: "0.25rem 0 0" }}>{info.explanation}</p>
                <p style={{ margin: "0.25rem 0 0", color: "#6b7280" }}>💡 {info.action}</p>
              </>
            );
          })()}
        </div>
      )}
    </form>
  );
}

// ── Field sub-component ───────────────────────────────────────────────────────

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

function Field({ id, label, error, hint, ...inputProps }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <label htmlFor={id} style={{ fontSize: "0.875rem", fontWeight: 600 }}>
        {label}
      </label>
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={!!error}
        style={{
          padding: "0.5rem 0.75rem",
          border: `1px solid ${error ? "var(--color-cancelled)" : "var(--color-border)"}`,
          borderRadius: "var(--radius)",
          fontSize: "0.95rem",
          outline: "none",
        }}
        {...inputProps}
      />
      {hint && (
        <span id={hintId} style={{ fontSize: "0.8rem", color: "#6b7280" }}>{hint}</span>
      )}
      {error && (
        <span
          id={errorId}
          role="alert"
          data-testid={`${id}-error`}
          style={{ fontSize: "0.8rem", color: "var(--color-cancelled)" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
