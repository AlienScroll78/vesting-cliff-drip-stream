"use client";

import { useEffect, useState, type ChangeEvent, type FocusEvent, type FormEvent, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { getErrorInfo } from "@/errorMessages";
import {
  RATE_DECIMALS,
  type CreateStreamRequest,
  daysToLedgers,
  deriveRate,
  depositFromRate,
  formatTokenAmount,
  isRateDepositOverflow,
  parseRateSegments,
  utf8ByteLength,
} from "@/utils/streamSchedule";

export const ADVANCED_OPTIONS_STORAGE_KEY = "vesting:stream-create:advanced";

export interface FormValues {
  recipient: string;
  token: string;
  totalAmount: string;
  cliffDays: string;
  totalDays: string;
  rate: string;
  variableRateSegments: string;
  metadata: string;
  allowlistOverride: boolean;
  feeOverrideBps: string;
}

export type FormErrors = Partial<Record<keyof FormValues, string>>;

const INITIAL_VALUES: FormValues = {
  recipient: "",
  token: "",
  totalAmount: "",
  cliffDays: "",
  totalDays: "",
  rate: "",
  variableRateSegments: "",
  metadata: "",
  allowlistOverride: false,
  feeOverrideBps: "",
};

const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;
const UINT32_MAX = 4_294_967_295;

function readAdvancedOptions(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ADVANCED_OPTIONS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function positiveNumber(value: string): boolean {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) && number > 0;
}

function positiveInteger(value: string): boolean {
  const number = Number(value);
  return value.trim() !== "" && Number.isSafeInteger(number) && number > 0;
}

function durationLedgers(value: string): number {
  return daysToLedgers(Number(value));
}

export function validateStreamCreateForm(
  values: FormValues,
  includeAdvanced: boolean,
  sponsor?: string | null,
): FormErrors {
  const errors: FormErrors = {};

  if (!values.recipient) {
    errors.recipient = "Recipient address is required.";
  } else if (!STELLAR_ADDRESS_RE.test(values.recipient)) {
    errors.recipient = "Must be a valid Stellar address (G…, 56 chars).";
  } else if (sponsor && values.recipient === sponsor) {
    errors.recipient = "Sponsor and recipient must be different addresses.";
  }

  if (!values.token) {
    errors.token = "Token contract address is required.";
  } else if (!CONTRACT_ADDRESS_RE.test(values.token)) {
    errors.token = "Must be a valid SAC contract address (C…, 56 chars).";
  }

  if (!positiveNumber(values.totalAmount)) {
    errors.totalAmount = "Total amount must be greater than 0.";
  } else if (Number(values.totalAmount) > Number.MAX_SAFE_INTEGER) {
    errors.totalAmount = "Total amount is too large.";
  }

  const cliff = Number(values.cliffDays);
  const total = Number(values.totalDays);
  const cliffLedgers = durationLedgers(values.cliffDays);
  const totalLedgers = durationLedgers(values.totalDays);

  if (!positiveNumber(values.cliffDays)) {
    errors.cliffDays = "Cliff must be a positive number of days.";
  } else if (!Number.isSafeInteger(cliffLedgers) || cliffLedgers > UINT32_MAX) {
    errors.cliffDays = "Cliff duration is too large.";
  }

  if (!positiveNumber(values.totalDays)) {
    errors.totalDays = "Total duration must be positive.";
  } else if (!Number.isSafeInteger(totalLedgers) || totalLedgers > UINT32_MAX) {
    errors.totalDays = "Total duration is too large.";
  } else if (values.cliffDays && total <= cliff) {
    errors.totalDays = "Total duration must be greater than cliff duration.";
  }

  if (!includeAdvanced) return errors;

  if (values.rate && !positiveInteger(values.rate)) {
    errors.rate = "Custom rate must be a positive integer.";
  }

  if (values.metadata && utf8ByteLength(values.metadata) > 256) {
    errors.metadata = "Metadata must be 256 UTF-8 bytes or fewer.";
  }

  if (values.feeOverrideBps) {
    const fee = Number(values.feeOverrideBps);
    if (!Number.isSafeInteger(fee) || fee < 0 || fee > 10_000) {
      errors.feeOverrideBps = "Fee override must be between 0 and 10,000 basis points.";
    }
  }

  const parsedSegments = parseRateSegments(values.variableRateSegments);
  if (parsedSegments.error) {
    errors.variableRateSegments = parsedSegments.error;
  } else if (parsedSegments.segments.length > 0) {
    const lastSegment = parsedSegments.segments[parsedSegments.segments.length - 1];
    if (lastSegment && lastSegment.endLedger <= cliffLedgers) {
      errors.variableRateSegments = "The final rate segment must end after the cliff.";
    } else if (lastSegment && totalLedgers > 0 && lastSegment.endLedger > totalLedgers) {
      errors.variableRateSegments = "Rate segments cannot end after the total duration.";
    }
  }

  return errors;
}

export function buildCreateStreamRequest(values: FormValues, sponsor: string): CreateStreamRequest {
  const totalLedgers = daysToLedgers(Number(values.totalDays));
  const customRate = values.rate.trim() ? Number(values.rate) : null;
  const rate = customRate ?? deriveRate(Number(values.totalAmount), totalLedgers) ?? 0;
  const parsedSegments = parseRateSegments(values.variableRateSegments);
  const request: CreateStreamRequest = {
    sponsor,
    recipient: values.recipient,
    token: values.token,
    amount: Number(values.totalAmount),
    rate,
    cliffLedgers: daysToLedgers(Number(values.cliffDays)),
    totalLedgers,
    allowlistOverride: values.allowlistOverride,
  };

  if (values.metadata) request.metadata = values.metadata;
  if (parsedSegments.segments.length > 0) request.variableRateSegments = parsedSegments.segments;
  if (values.feeOverrideBps) request.feeOverrideBps = Number(values.feeOverrideBps);
  return request;
}

interface TxResult {
  hash: string;
}

async function submitCreateStream(_params: CreateStreamRequest): Promise<TxResult> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return { hash: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("") };
}

interface Props {
  onSuccess?: (hash: string) => void;
}

export function StreamCreateForm({ onSuccess }: Props) {
  const { address: sponsor } = useWallet();
  const [values, setValues] = useState<FormValues>({ ...INITIAL_VALUES });
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});
  const [advancedOpen, setAdvancedOpen] = useState(readAdvancedOptions);
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [contractError, setContractError] = useState<number | null>(null);
  // Persistent aria-live region announces form submission outcomes to screen readers.
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ADVANCED_OPTIONS_STORAGE_KEY, String(advancedOpen));
    } catch {
      return;
    }
  }, [advancedOpen]);

  const errors = validateStreamCreateForm(values, advancedOpen, sponsor);
  const hasErrors = Object.keys(errors).length > 0;
  const cliffLedgers = durationLedgers(values.cliffDays);
  const totalLedgers = durationLedgers(values.totalDays);
  const customRate = values.rate.trim() ? Number(values.rate) : null;
  const effectiveRate = customRate ?? deriveRate(Number(values.totalAmount), totalLedgers);
  const estimatedDeposit = customRate && totalLedgers > 0
    ? depositFromRate(customRate, totalLedgers)
    : positiveNumber(values.totalAmount)
      ? Number(values.totalAmount)
      : null;
  const overflow = effectiveRate !== null && isRateDepositOverflow(effectiveRate, totalLedgers);

  function handleChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const control = event.currentTarget;
    const nextValue = control instanceof HTMLInputElement && control.type === "checkbox"
      ? control.checked
      : control.value;
    setValues((previous) => ({ ...previous, [control.name]: nextValue } as FormValues));
    setTxHash(null);
    setContractError(null);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const name = event.currentTarget.name as keyof FormValues;
    setTouched((previous) => ({ ...previous, [name]: true }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({
      recipient: true,
      token: true,
      totalAmount: true,
      cliffDays: true,
      totalDays: true,
      rate: advancedOpen,
      variableRateSegments: advancedOpen,
      metadata: advancedOpen,
      allowlistOverride: advancedOpen,
      feeOverrideBps: advancedOpen,
    });
    const submissionErrors = validateStreamCreateForm(values, advancedOpen, sponsor);
    if (Object.keys(submissionErrors).length > 0 || !sponsor) return;
    const request = buildCreateStreamRequest(values, sponsor);
    if (isRateDepositOverflow(request.rate, request.totalLedgers)) return;

    setSubmitting(true);
    setContractError(null);
    setLiveAnnouncement("Submitting vesting stream…");
    try {
      const result = await submitCreateStream(request);
      setTxHash(result.hash);
      setLiveAnnouncement("Vesting stream created successfully.");
      onSuccess?.(result.hash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const match = /code[:\s]+(\d+)/i.exec(message) ?? /error[:\s]+(\d+)/i.exec(message);
      setContractError(match ? Number(match[1]) : 0);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleAdvanced() {
    setAdvancedOpen((open) => !open);
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Create vesting stream"
      data-testid="stream-create-form"
      style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
    >
      {/*
        Persistent aria-live="assertive" region announces form submission outcomes
        (success, error, submitting) to screen readers without requiring focus change.
        The region is visually hidden but always present in the DOM.
      */}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        data-testid="form-live-region"
      >
        {liveAnnouncement}
      </div>

      <Field
        id="recipient"
        name="recipient"
        label="Recipient address"
        placeholder="G…"
        required
        aria-required="true"
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
        required
        aria-required="true"
        value={values.token}
        error={touched.token ? errors.token : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      <Field
        id="totalAmount"
        name="totalAmount"
        label="Total amount (tokens)"
        placeholder="e.g. 1000"
        type="number"
        min="0.0000001"
        step="any"
        value={values.totalAmount}
        error={touched.totalAmount ? errors.totalAmount : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      <Field
        id="cliffDays"
        name="cliffDays"
        label="Cliff duration (days)"
        placeholder="e.g. 30"
        type="number"
        min="0.00005787"
        step="any"
        required
        aria-required="true"
        value={values.cliffDays}
        error={touched.cliffDays ? errors.cliffDays : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
        hint={cliffLedgers > 0 ? `≈ ${cliffLedgers.toLocaleString()} ledgers` : undefined}
      />
      <Field
        id="totalDays"
        name="totalDays"
        label="Total duration (days)"
        placeholder="e.g. 365"
        type="number"
        min="0.00005787"
        step="any"
        required
        aria-required="true"
        value={values.totalDays}
        error={touched.totalDays ? errors.totalDays : undefined}
        onChange={handleChange}
        onBlur={handleBlur}
        hint={totalLedgers > 0 ? `≈ ${totalLedgers.toLocaleString()} ledgers` : undefined}
      />

      <button
        type="button"
        className="btn btn-ghost"
        onClick={toggleAdvanced}
        aria-expanded={advancedOpen}
        aria-controls="stream-create-advanced"
        data-testid="advanced-options-toggle"
      >
        {advancedOpen ? "Hide advanced options" : "Show advanced options"}
      </button>

      {advancedOpen && (
        <fieldset
          id="stream-create-advanced"
          data-testid="stream-create-advanced"
          aria-labelledby="stream-create-advanced-legend"
          style={{ border: "1px solid var(--color-border, #d1d5db)", borderRadius: "var(--radius, 0.5rem)", padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          <legend id="stream-create-advanced-legend" style={{ fontWeight: 700 }}>Advanced options</legend>
          <Field
            id="rate"
            name="rate"
            label="Custom rate (tokens per ledger)"
            placeholder="Leave blank to derive from amount and duration"
            type="number"
            min="1"
            step="1"
            value={values.rate}
            error={touched.rate ? errors.rate : undefined}
            onChange={handleChange}
            onBlur={handleBlur}
            hint="Raw contract units are scaled by 10,000,000."
          />
          <TextAreaField
            id="variableRateSegments"
            name="variableRateSegments"
            label="Variable rate segments"
            placeholder={"17280, 10000000\n34560, 20000000"}
            value={values.variableRateSegments}
            error={touched.variableRateSegments ? errors.variableRateSegments : undefined}
            onChange={handleChange}
            onBlur={handleBlur}
            hint="One segment per line: end ledger, rate. Maximum 10 segments."
          />
          <TextAreaField
            id="metadata"
            name="metadata"
            label="Metadata"
            placeholder="Optional metadata"
            value={values.metadata}
            error={touched.metadata ? errors.metadata : undefined}
            onChange={handleChange}
            onBlur={handleBlur}
            hint={values.metadata ? `${utf8ByteLength(values.metadata)} / 256 UTF-8 bytes` : "Optional, up to 256 UTF-8 bytes."}
          />
          <Field
            id="feeOverrideBps"
            name="feeOverrideBps"
            label="Fee override (basis points)"
            placeholder="Optional, 0–10,000"
            type="number"
            min="0"
            max="10000"
            step="1"
            value={values.feeOverrideBps}
            error={touched.feeOverrideBps ? errors.feeOverrideBps : undefined}
            onChange={handleChange}
            onBlur={handleBlur}
          />
          <label htmlFor="allowlistOverride" style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <input
              id="allowlistOverride"
              name="allowlistOverride"
              type="checkbox"
              checked={values.allowlistOverride}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{ width: "1rem", height: "1rem" }}
            />
            Allowlist override
          </label>
        </fieldset>
      )}

      {overflow && (
        <div
          role="alert"
          data-testid="overflow-warning"
          style={{ padding: "0.75rem 1rem", background: "var(--color-error-50, #fef2f2)", border: "1px solid var(--color-cancelled, #dc2626)", borderRadius: "var(--radius, 0.5rem)", fontSize: "0.875rem", color: "var(--color-cancelled, #dc2626)" }}
        >
          <strong>Deposit overflow</strong>
          <p style={{ margin: "0.25rem 0 0" }}>Rate × total duration exceeds the supported contract range.</p>
        </div>
      )}

      {estimatedDeposit !== null && !hasErrors && !overflow && (
        <div
          role="status"
          aria-live="polite"
          data-testid="deposit-preview"
          style={{ padding: "0.75rem 1rem", background: "var(--color-secondary-50, #eef2ff)", border: "1px solid var(--color-active, #4f46e5)", borderRadius: "var(--radius, 0.5rem)", fontSize: "0.875rem" }}
        >
          <strong>Estimated total deposit:</strong> {formatTokenAmount(estimatedDeposit)} tokens
          <span style={{ color: "var(--color-text-secondary, #6b7280)", marginLeft: "0.5rem" }}>
            ({customRate ? "custom rate" : "derived rate"}: {formatTokenAmount((effectiveRate ?? 0) / RATE_DECIMALS)} tokens/ledger)
          </span>
        </div>
      )}

      {!sponsor && (
        <p style={{ fontSize: "0.875rem", color: "var(--color-cancelled, #dc2626)" }} role="alert">
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

      {txHash && (
        <div role="status" data-testid="tx-success" style={{ padding: "0.75rem 1rem", background: "var(--color-success-50, #ecfdf5)", border: "1px solid var(--color-completed, #10b981)", borderRadius: "var(--radius, 0.5rem)", fontSize: "0.875rem" }}>
          <strong style={{ color: "var(--color-completed, #10b981)" }}>Stream created</strong>
          <div style={{ marginTop: "0.35rem" }}>Tx: <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontFamily: "monospace", wordBreak: "break-all", color: "var(--color-active, #4f46e5)" }} aria-label={`View transaction ${txHash} on Stellar Expert`}>{txHash}</a></div>
        </div>
      )}

      {contractError !== null && !txHash && (
        <div role="alert" data-testid="contract-error" style={{ padding: "0.75rem 1rem", background: "var(--color-error-50, #fef2f2)", border: "1px solid var(--color-cancelled, #dc2626)", borderRadius: "var(--radius, 0.5rem)", fontSize: "0.875rem" }}>
          {(() => {
            const info = getErrorInfo(contractError);
            return <><strong style={{ color: "var(--color-cancelled, #dc2626)" }}>{info.title}</strong><p style={{ margin: "0.25rem 0 0" }}>{info.explanation}</p><p style={{ margin: "0.25rem 0 0", color: "var(--color-text-secondary, #6b7280)" }}>{info.action}</p></>;
          })()}
        </div>
      )}
    </form>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

function Field({ id, label, error, hint, required, ...inputProps }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <label htmlFor={id} style={{ fontSize: "0.875rem", fontWeight: 600 }}>{label}</label>
      <input
        id={id}
        required={required}
        aria-required={required ? "true" : undefined}
        aria-describedby={describedBy}
        aria-invalid={!!error}
        style={{ padding: "0.5rem 0.75rem", border: `1px solid ${error ? "var(--color-cancelled, #dc2626)" : "var(--color-border, #d1d5db)"}`, borderRadius: "var(--radius, 0.5rem)", fontSize: "0.95rem", outline: "none" }}
        {...inputProps}
      />
      {hint && <span id={hintId} style={{ fontSize: "0.8rem", color: "var(--color-text-secondary, #6b7280)" }}>{hint}</span>}
      {error && <span id={errorId} role="alert" data-testid={`${id}-error`} style={{ fontSize: "0.8rem", color: "var(--color-cancelled, #dc2626)" }}>{error}</span>}
    </div>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
}

function TextAreaField({ id, label, error, hint, ...textareaProps }: TextAreaFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <label htmlFor={id} style={{ fontSize: "0.875rem", fontWeight: 600 }}>{label}</label>
      <textarea
        id={id}
        aria-describedby={describedBy}
        aria-invalid={!!error}
        rows={3}
        style={{ padding: "0.5rem 0.75rem", border: `1px solid ${error ? "var(--color-cancelled, #dc2626)" : "var(--color-border, #d1d5db)"}`, borderRadius: "var(--radius, 0.5rem)", fontSize: "0.95rem", outline: "none", resize: "vertical" }}
        {...textareaProps}
      />
      {hint && <span id={hintId} style={{ fontSize: "0.8rem", color: "var(--color-text-secondary, #6b7280)" }}>{hint}</span>}
      {error && <span id={errorId} role="alert" data-testid={`${id}-error`} style={{ fontSize: "0.8rem", color: "var(--color-cancelled, #dc2626)" }}>{error}</span>}
    </div>
  );
}
