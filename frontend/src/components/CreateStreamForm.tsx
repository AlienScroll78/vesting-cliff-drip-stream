"use client";
import {
  useState,
  useCallback,
  useReducer,
  useId,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Approximate seconds per Stellar ledger */
const SECONDS_PER_LEDGER = 5;

/** Supported tokens (extend as needed) */
const SUPPORTED_TOKENS = [
  { symbol: "XLM", address: "native", name: "Stellar Lumens" },
  { symbol: "USDC", address: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", name: "USD Coin" },
  { symbol: "AQUA", address: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA", name: "Aquarius" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type StreamStep = "recipient" | "token" | "schedule" | "review" | "sign";

interface FormState {
  // Step 1 – Recipient
  recipientAddress: string;

  // Step 2 – Token
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  sponsorBalance: string;

  // Step 3 – Schedule
  rateLedger: string;
  cliffDays: string;
  totalDays: string;

  // Step 5 – Result
  streamId: string | null;
  txHash: string | null;
}

interface FormErrors {
  recipientAddress?: string;
  tokenAddress?: string;
  rateLedger?: string;
  cliffDays?: string;
  totalDays?: string;
}

type FormAction =
  | { type: "SET_FIELD"; field: keyof FormState; value: string }
  | { type: "SET_TOKEN"; symbol: string; address: string; name: string }
  | { type: "SET_RESULT"; streamId: string; txHash: string }
  | { type: "RESET" };

const INITIAL_STATE: FormState = {
  recipientAddress: "",
  tokenAddress: "",
  tokenSymbol: "",
  tokenName: "",
  sponsorBalance: "",
  rateLedger: "",
  cliffDays: "",
  totalDays: "",
  streamId: null,
  txHash: null,
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SET_TOKEN":
      return {
        ...state,
        tokenSymbol: action.symbol,
        tokenAddress: action.address,
        tokenName: action.name,
      };
    case "SET_RESULT":
      return { ...state, streamId: action.streamId, txHash: action.txHash };
    case "RESET":
      return INITIAL_STATE;
    default:
      return state;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysToLedgers(days: number): number {
  return Math.round((days * 24 * 60 * 60) / SECONDS_PER_LEDGER);
}

function ledgersToDays(ledgers: number): number {
  return (ledgers * SECONDS_PER_LEDGER) / (24 * 60 * 60);
}

function isValidStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr);
}

function fmtNum(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function computeTotalDeposit(rateLedger: string, totalDays: string): bigint | null {
  const rate = parseFloat(rateLedger);
  const days = parseFloat(totalDays);
  if (isNaN(rate) || isNaN(days) || rate <= 0 || days <= 0) return null;
  const ledgers = daysToLedgers(days);
  return BigInt(Math.round(rate * ledgers));
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS: { id: StreamStep; label: string }[] = [
  { id: "recipient", label: "Recipient" },
  { id: "token",     label: "Token"     },
  { id: "schedule",  label: "Schedule"  },
  { id: "review",    label: "Review"    },
  { id: "sign",      label: "Sign"      },
];

function StepIndicator({
  current,
}: {
  current: StreamStep;
}) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);
  return (
    <nav aria-label="Form steps" style={{ marginBottom: "28px" }}>
      <ol
        style={{
          display: "flex",
          listStyle: "none",
          margin: 0,
          padding: 0,
          gap: "0",
          position: "relative",
        }}
      >
        {STEPS.map((step, idx) => {
          const done = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <li
              key={step.id}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "6px",
                position: "relative",
              }}
            >
              {/* connector line */}
              {idx > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: "14px",
                    right: "50%",
                    left: "-50%",
                    height: "2px",
                    background: done
                      ? "var(--color-completed, #15803d)"
                      : "var(--color-border, #334155)",
                    zIndex: 0,
                  }}
                />
              )}
              {/* circle */}
              <span
                aria-current={active ? "step" : undefined}
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: 700,
                  zIndex: 1,
                  border: "2px solid",
                  borderColor: active
                    ? "var(--color-brand-primary, #7C3AED)"
                    : done
                    ? "var(--color-completed, #15803d)"
                    : "var(--color-border, #334155)",
                  background: done
                    ? "var(--color-completed, #15803d)"
                    : active
                    ? "var(--color-brand-primary, #7C3AED)"
                    : "var(--color-bg-surface, #1E293B)",
                  color: done || active ? "#fff" : "var(--color-text-secondary, #94a3b8)",
                }}
              >
                {done ? "✓" : idx + 1}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: active ? 700 : 400,
                  color: active
                    ? "var(--color-brand-primary, #7C3AED)"
                    : done
                    ? "var(--color-completed, #15803d)"
                    : "var(--color-text-secondary, #94a3b8)",
                  textAlign: "center",
                }}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Field components ─────────────────────────────────────────────────────────

function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label
        htmlFor={id}
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--color-text-primary, #f8fafc)",
        }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "#ef4444", marginLeft: "3px" }}>
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #94a3b8)", margin: 0 }}>
          {hint}
        </p>
      )}
      {error && (
        <p
          role="alert"
          style={{ fontSize: "12px", color: "var(--color-cancelled, #ef4444)", margin: 0 }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--color-bg-elevated, #334155)",
  border: "1px solid var(--color-border, #475569)",
  borderRadius: "8px",
  color: "var(--color-text-primary, #f8fafc)",
  fontSize: "14px",
  outline: "none",
  padding: "10px 12px",
  width: "100%",
  boxSizing: "border-box",
};

const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "var(--color-cancelled, #ef4444)",
};

// ─── Step 1: Recipient ────────────────────────────────────────────────────────

function StepRecipient({
  state,
  errors,
  dispatch,
}: {
  state: FormState;
  errors: FormErrors;
  dispatch: React.Dispatch<FormAction>;
}) {
  const fieldId = useId();

  // Simple federated address resolver hint
  const isFederated = state.recipientAddress.includes("*");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h3
          style={{
            margin: "0 0 4px",
            fontSize: "17px",
            fontWeight: 700,
            color: "var(--color-text-primary, #f8fafc)",
          }}
        >
          Recipient Address
        </h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary, #94a3b8)" }}>
          Enter the Stellar address of the vesting recipient.
        </p>
      </div>

      <FormField
        id={fieldId}
        label="Stellar Address"
        error={errors.recipientAddress}
        hint={
          isFederated
            ? "Federated address detected — will resolve on submit"
            : "Must be a valid Stellar public key (starts with G)"
        }
        required
      >
        <input
          id={fieldId}
          type="text"
          value={state.recipientAddress}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            dispatch({ type: "SET_FIELD", field: "recipientAddress", value: e.target.value })
          }
          placeholder="GABC...XYZ or name*example.com"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!errors.recipientAddress}
          style={errors.recipientAddress ? inputErrorStyle : inputStyle}
        />
      </FormField>

      {state.recipientAddress && !errors.recipientAddress && isValidStellarAddress(state.recipientAddress) && (
        <div
          style={{
            background: "rgba(21, 128, 61, 0.1)",
            border: "1px solid rgba(21, 128, 61, 0.3)",
            borderRadius: "8px",
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span aria-hidden="true" style={{ fontSize: "16px" }}>✓</span>
          <span style={{ fontSize: "13px", color: "#4ade80", fontFamily: "monospace" }}>
            {state.recipientAddress.slice(0, 8)}…{state.recipientAddress.slice(-6)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Token ────────────────────────────────────────────────────────────

function StepToken({
  state,
  errors,
  dispatch,
}: {
  state: FormState;
  errors: FormErrors;
  dispatch: React.Dispatch<FormAction>;
}) {
  const customId = useId();
  const [custom, setCustom] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h3
          style={{
            margin: "0 0 4px",
            fontSize: "17px",
            fontWeight: 700,
            color: "var(--color-text-primary, #f8fafc)",
          }}
        >
          Select Token
        </h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary, #94a3b8)" }}>
          Choose the token to stream, or paste a contract address.
        </p>
      </div>

      {/* Token tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "10px" }}>
        {SUPPORTED_TOKENS.map((t) => (
          <button
            key={t.symbol}
            type="button"
            onClick={() => {
              dispatch({ type: "SET_TOKEN", symbol: t.symbol, address: t.address, name: t.name });
              setCustom(false);
            }}
            aria-pressed={state.tokenSymbol === t.symbol && !custom}
            style={{
              background:
                state.tokenSymbol === t.symbol && !custom
                  ? "rgba(124,58,237,0.15)"
                  : "var(--color-bg-elevated, #334155)",
              border: `2px solid ${
                state.tokenSymbol === t.symbol && !custom
                  ? "var(--color-brand-primary, #7C3AED)"
                  : "var(--color-border, #475569)"
              }`,
              borderRadius: "10px",
              color: "var(--color-text-primary, #f8fafc)",
              cursor: "pointer",
              padding: "14px 12px",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "15px" }}>{t.symbol}</div>
            <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #94a3b8)", marginTop: "3px" }}>
              {t.name}
            </div>
          </button>
        ))}

        {/* Custom address tile */}
        <button
          type="button"
          onClick={() => {
            setCustom(true);
            dispatch({ type: "SET_TOKEN", symbol: "", address: "", name: "Custom" });
          }}
          aria-pressed={custom}
          style={{
            background: custom ? "rgba(124,58,237,0.15)" : "var(--color-bg-elevated, #334155)",
            border: `2px solid ${custom ? "var(--color-brand-primary, #7C3AED)" : "var(--color-border, #475569)"}`,
            borderRadius: "10px",
            color: "var(--color-text-primary, #f8fafc)",
            cursor: "pointer",
            padding: "14px 12px",
            textAlign: "left",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: "15px" }}>Custom</div>
          <div style={{ fontSize: "11px", color: "var(--color-text-secondary, #94a3b8)", marginTop: "3px" }}>
            Paste contract address
          </div>
        </button>
      </div>

      {custom && (
        <FormField
          id={customId}
          label="Contract Address"
          error={errors.tokenAddress}
          hint="Paste the SAC token contract address (starts with C or G)"
          required
        >
          <input
            id={customId}
            type="text"
            value={state.tokenAddress}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              dispatch({ type: "SET_FIELD", field: "tokenAddress", value: e.target.value })
            }
            placeholder="CABC...XYZ"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!errors.tokenAddress}
            style={errors.tokenAddress ? inputErrorStyle : inputStyle}
          />
        </FormField>
      )}

      {state.sponsorBalance && (
        <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary, #94a3b8)" }}>
          Your balance:{" "}
          <strong style={{ color: "var(--color-text-primary, #f8fafc)" }}>
            {state.sponsorBalance} {state.tokenSymbol}
          </strong>
        </p>
      )}
    </div>
  );
}

// ─── Step 3: Schedule ─────────────────────────────────────────────────────────

function StepSchedule({
  state,
  errors,
  dispatch,
}: {
  state: FormState;
  errors: FormErrors;
  dispatch: React.Dispatch<FormAction>;
}) {
  const rateId = useId();
  const cliffId = useId();
  const totalId = useId();

  const cliffLedgers = parseFloat(state.cliffDays)
    ? daysToLedgers(parseFloat(state.cliffDays))
    : 0;
  const totalLedgers = parseFloat(state.totalDays)
    ? daysToLedgers(parseFloat(state.totalDays))
    : 0;
  const totalDeposit = computeTotalDeposit(state.rateLedger, state.totalDays);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h3
          style={{
            margin: "0 0 4px",
            fontSize: "17px",
            fontWeight: 700,
            color: "var(--color-text-primary, #f8fafc)",
          }}
        >
          Vesting Schedule
        </h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary, #94a3b8)" }}>
          Define the rate, cliff, and duration of the stream.
        </p>
      </div>

      <FormField
        id={rateId}
        label={`Rate (${state.tokenSymbol || "tokens"} / ledger)`}
        error={errors.rateLedger}
        hint="Tokens released per ledger (~5 s). Positive integer or decimal."
        required
      >
        <input
          id={rateId}
          type="number"
          min="0"
          step="any"
          value={state.rateLedger}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            dispatch({ type: "SET_FIELD", field: "rateLedger", value: e.target.value })
          }
          placeholder="e.g. 10"
          aria-invalid={!!errors.rateLedger}
          style={errors.rateLedger ? inputErrorStyle : inputStyle}
        />
      </FormField>

      <FormField
        id={cliffId}
        label="Cliff duration (days)"
        error={errors.cliffDays}
        hint={cliffLedgers > 0 ? `≈ ${fmtNum(cliffLedgers)} ledgers` : "Ledgers before any tokens unlock"}
        required
      >
        <input
          id={cliffId}
          type="number"
          min="0"
          step="any"
          value={state.cliffDays}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            dispatch({ type: "SET_FIELD", field: "cliffDays", value: e.target.value })
          }
          placeholder="e.g. 30"
          aria-invalid={!!errors.cliffDays}
          style={errors.cliffDays ? inputErrorStyle : inputStyle}
        />
      </FormField>

      <FormField
        id={totalId}
        label="Total duration (days)"
        error={errors.totalDays}
        hint={totalLedgers > 0 ? `≈ ${fmtNum(totalLedgers)} ledgers` : "Must be greater than cliff duration"}
        required
      >
        <input
          id={totalId}
          type="number"
          min="0"
          step="any"
          value={state.totalDays}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            dispatch({ type: "SET_FIELD", field: "totalDays", value: e.target.value })
          }
          placeholder="e.g. 365"
          aria-invalid={!!errors.totalDays}
          style={errors.totalDays ? inputErrorStyle : inputStyle}
        />
      </FormField>

      {/* Live preview timeline */}
      {totalLedgers > 0 && cliffLedgers > 0 && !errors.cliffDays && !errors.totalDays && (
        <div
          style={{
            marginTop: "4px",
            background: "var(--color-bg-elevated, #334155)",
            borderRadius: "10px",
            padding: "14px",
          }}
        >
          <p
            style={{
              margin: "0 0 10px",
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--color-text-secondary, #94a3b8)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Timeline Preview
          </p>
          <div
            style={{
              display: "flex",
              height: "24px",
              borderRadius: "6px",
              overflow: "hidden",
            }}
          >
            {/* Cliff portion */}
            <div
              title="Cliff period"
              style={{
                width: `${Math.min((cliffLedgers / totalLedgers) * 100, 100)}%`,
                background: "#b45309",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "10px",
                color: "#fff",
                fontWeight: 700,
                minWidth: "4px",
              }}
            >
              {(cliffLedgers / totalLedgers) * 100 > 15 ? "CLIFF" : ""}
            </div>
            {/* Drip portion */}
            <div
              title="Linear drip"
              style={{
                flex: 1,
                background: "#ca8a04",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "10px",
                color: "#fff",
                fontWeight: 700,
              }}
            >
              DRIP
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "6px",
              fontSize: "11px",
              color: "var(--color-text-secondary, #94a3b8)",
            }}
          >
            <span>Start</span>
            <span>Cliff: day {state.cliffDays}</span>
            <span>End: day {state.totalDays}</span>
          </div>
          {totalDeposit !== null && (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: "13px",
                color: "var(--color-text-secondary, #94a3b8)",
              }}
            >
              Total deposit:{" "}
              <strong style={{ color: "var(--color-text-primary, #f8fafc)" }}>
                {fmtNum(Number(totalDeposit))} {state.tokenSymbol || "tokens"}
              </strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Review ───────────────────────────────────────────────────────────

function StepReview({ state }: { state: FormState }) {
  const totalDeposit = computeTotalDeposit(state.rateLedger, state.totalDays);
  const cliffLedgers = daysToLedgers(parseFloat(state.cliffDays) || 0);
  const totalLedgers = daysToLedgers(parseFloat(state.totalDays) || 0);

  const rows: { label: string; value: string }[] = [
    {
      label: "Recipient",
      value: `${state.recipientAddress.slice(0, 8)}…${state.recipientAddress.slice(-6)}`,
    },
    { label: "Token", value: `${state.tokenName} (${state.tokenSymbol})` },
    { label: "Rate", value: `${state.rateLedger} ${state.tokenSymbol} / ledger` },
    {
      label: "Cliff duration",
      value: `${state.cliffDays} days (${fmtNum(cliffLedgers)} ledgers)`,
    },
    {
      label: "Total duration",
      value: `${state.totalDays} days (${fmtNum(totalLedgers)} ledgers)`,
    },
    {
      label: "Total deposit",
      value: totalDeposit !== null ? `${fmtNum(Number(totalDeposit))} ${state.tokenSymbol}` : "—",
    },
    { label: "Est. gas", value: "~0.00001 XLM" },
  ];

  const insufficient =
    state.sponsorBalance !== "" &&
    totalDeposit !== null &&
    Number(state.sponsorBalance) < Number(totalDeposit);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h3
          style={{
            margin: "0 0 4px",
            fontSize: "17px",
            fontWeight: 700,
            color: "var(--color-text-primary, #f8fafc)",
          }}
        >
          Review Stream
        </h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary, #94a3b8)" }}>
          Confirm all parameters before signing.
        </p>
      </div>

      <dl
        style={{
          margin: 0,
          background: "var(--color-bg-elevated, #334155)",
          borderRadius: "10px",
          overflow: "hidden",
        }}
      >
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderBottom: i < rows.length - 1 ? "1px solid var(--color-border, #1E293B)" : "none",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <dt
              style={{
                fontSize: "13px",
                color: "var(--color-text-secondary, #94a3b8)",
                fontWeight: 500,
              }}
            >
              {row.label}
            </dt>
            <dd
              style={{
                margin: 0,
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--color-text-primary, #f8fafc)",
                fontFamily: row.label === "Recipient" ? "monospace" : undefined,
                textAlign: "right",
              }}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {insufficient && (
        <div
          role="alert"
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "8px",
            padding: "10px 14px",
            fontSize: "13px",
            color: "#f87171",
          }}
        >
          ⚠️ Insufficient balance. You need{" "}
          <strong>
            {totalDeposit !== null ? fmtNum(Number(totalDeposit)) : "—"} {state.tokenSymbol}
          </strong>{" "}
          but have{" "}
          <strong>
            {state.sponsorBalance} {state.tokenSymbol}
          </strong>
          .
        </div>
      )}
    </div>
  );
}

// ─── Step 5: Sign / Success ───────────────────────────────────────────────────

function StepSign({
  state,
  signing,
  signError,
}: {
  state: FormState;
  signing: boolean;
  signError: string | null;
}) {
  if (state.streamId) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "20px",
          textAlign: "center",
          padding: "24px 0",
        }}
      >
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            background: "var(--color-completed, #15803d)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "28px",
          }}
        >
          ✓
        </motion.div>
        <div>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--color-text-primary, #f8fafc)",
            }}
          >
            Stream Created!
          </h3>
          <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary, #94a3b8)" }}>
            The vesting stream has been deployed to the Stellar network.
          </p>
        </div>

        <div
          style={{
            background: "var(--color-bg-elevated, #334155)",
            borderRadius: "10px",
            padding: "14px 16px",
            width: "100%",
            maxWidth: "400px",
            textAlign: "left",
          }}
        >
          <p
            style={{
              margin: "0 0 4px",
              fontSize: "12px",
              color: "var(--color-text-secondary, #94a3b8)",
            }}
          >
            Stream ID
          </p>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: "13px",
              fontFamily: "monospace",
              color: "var(--color-text-primary, #f8fafc)",
              wordBreak: "break-all",
            }}
          >
            {state.streamId}
          </p>
          {state.txHash && (
            <>
              <p
                style={{
                  margin: "0 0 4px",
                  fontSize: "12px",
                  color: "var(--color-text-secondary, #94a3b8)",
                }}
              >
                Transaction
              </p>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${state.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "13px",
                  fontFamily: "monospace",
                  color: "var(--color-brand-primary, #7C3AED)",
                  wordBreak: "break-all",
                }}
              >
                {state.txHash.slice(0, 12)}…{state.txHash.slice(-8)} ↗
              </a>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h3
          style={{
            margin: "0 0 4px",
            fontSize: "17px",
            fontWeight: 700,
            color: "var(--color-text-primary, #f8fafc)",
          }}
        >
          Sign & Submit
        </h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary, #94a3b8)" }}>
          Your wallet will be prompted to sign the transaction.
        </p>
      </div>

      <div
        style={{
          background: "var(--color-bg-elevated, #334155)",
          borderRadius: "10px",
          padding: "16px",
          fontSize: "13px",
          color: "var(--color-text-secondary, #94a3b8)",
          lineHeight: "1.6",
        }}
      >
        <p style={{ margin: "0 0 8px" }}>
          By signing this transaction you authorise the transfer of{" "}
          <strong style={{ color: "var(--color-text-primary, #f8fafc)" }}>
            {computeTotalDeposit(state.rateLedger, state.totalDays) !== null
              ? `${fmtNum(Number(computeTotalDeposit(state.rateLedger, state.totalDays)))} ${state.tokenSymbol}`
              : "the deposit amount"}
          </strong>{" "}
          into the vesting contract vault.
        </p>
        <p style={{ margin: 0 }}>
          This action is irreversible once submitted. You can cancel the stream
          later as the sponsor, but the cliff rules will apply.
        </p>
      </div>

      {signing && (
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "14px",
            color: "var(--color-text-secondary, #94a3b8)",
          }}
        >
          <Spinner />
          Waiting for wallet signature…
        </div>
      )}

      {signError && (
        <div
          role="alert"
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "8px",
            padding: "10px 14px",
            fontSize: "13px",
            color: "#f87171",
          }}
        >
          {signError}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "16px",
        height: "16px",
        border: "2px solid var(--color-border, #475569)",
        borderTopColor: "var(--color-brand-primary, #7C3AED)",
        borderRadius: "50%",
        animation: "create-stream-spin 0.7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateStep(step: StreamStep, state: FormState): FormErrors {
  const errors: FormErrors = {};
  if (step === "recipient") {
    if (!state.recipientAddress) {
      errors.recipientAddress = "Recipient address is required.";
    } else if (!state.recipientAddress.includes("*") && !isValidStellarAddress(state.recipientAddress)) {
      errors.recipientAddress = "Invalid Stellar address. Must start with G and be 56 characters.";
    }
  }
  if (step === "token") {
    if (!state.tokenAddress) {
      errors.tokenAddress = "Please select or enter a token.";
    }
  }
  if (step === "schedule") {
    const rate = parseFloat(state.rateLedger);
    const cliff = parseFloat(state.cliffDays);
    const total = parseFloat(state.totalDays);

    if (!state.rateLedger || isNaN(rate) || rate <= 0) {
      errors.rateLedger = "Rate must be a positive number.";
    }
    if (!state.cliffDays || isNaN(cliff) || cliff < 0) {
      errors.cliffDays = "Cliff duration must be 0 or more days.";
    }
    if (!state.totalDays || isNaN(total) || total <= 0) {
      errors.totalDays = "Total duration must be a positive number.";
    } else if (!isNaN(cliff) && total <= cliff) {
      errors.totalDays = "Total duration must be greater than cliff duration.";
    }
  }
  return errors;
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface CreateStreamFormProps {
  /** Connected wallet address. Form is disabled if not provided. */
  sponsorAddress?: string;
  /** Called after successful stream creation */
  onSuccess?: (streamId: string) => void;
}

/**
 * CreateStreamForm — multi-step form for sponsors to create vesting streams.
 *
 * Steps:
 *  1. Recipient — enter/validate Stellar address
 *  2. Token     — pick from supported list or paste contract address
 *  3. Schedule  — rate, cliff, duration with live preview
 *  4. Review    — summary + deposit cost
 *  5. Sign      — wallet signing + success screen
 *
 * Uses native React state (no external form library) to keep the dependency
 * footprint minimal. Real-time ledger ↔ day conversion assumes 5 s/ledger.
 * Form state is preserved across wallet pop-up focus loss.
 */
export function CreateStreamForm({ sponsorAddress, onSuccess }: CreateStreamFormProps) {
  const [step, setStep] = useState<StreamStep>("recipient");
  const [state, dispatch] = useReducer(formReducer, INITIAL_STATE);
  const [errors, setErrors] = useState<FormErrors>({});
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  // Step ordering
  const stepOrder: StreamStep[] = ["recipient", "token", "schedule", "review", "sign"];
  const stepIndex = stepOrder.indexOf(step);

  const handleNext = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const errs = validateStep(step, state);
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        return;
      }
      setErrors({});
      const next = stepOrder[stepIndex + 1];
      if (next) setStep(next);
    },
    [step, state, stepIndex, stepOrder]
  );

  const handleBack = useCallback(() => {
    setErrors({});
    const prev = stepOrder[stepIndex - 1];
    if (prev) setStep(prev);
  }, [stepIndex, stepOrder]);

  const handleSign = useCallback(async () => {
    setSignError(null);
    setSigning(true);
    try {
      // In a real implementation this would:
      // 1. Call POST /api/build-create-tx to simulate the transaction
      // 2. Pass the XDR to the wallet (Freighter/etc.) to sign
      // 3. Submit the signed XDR to the network
      // 4. Poll for confirmation
      //
      // Simulated delay to represent wallet + network round-trip:
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const mockStreamId = `stream_${Math.random().toString(36).slice(2, 10)}`;
      const mockTxHash = Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");

      dispatch({ type: "SET_RESULT", streamId: mockStreamId, txHash: mockTxHash });
      onSuccess?.(mockStreamId);
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Transaction failed. Please try again.");
    } finally {
      setSigning(false);
    }
  }, [onSuccess]);

  const handleReset = useCallback(() => {
    dispatch({ type: "RESET" });
    setStep("recipient");
    setErrors({});
    setSignError(null);
  }, []);

  if (!sponsorAddress) {
    return (
      <div
        style={{
          background: "var(--color-bg-surface, #1E293B)",
          borderRadius: "12px",
          padding: "32px",
          textAlign: "center",
          fontFamily: "var(--font-family-base, system-ui, sans-serif)",
        }}
      >
        <p style={{ fontSize: "16px", color: "var(--color-text-secondary, #94a3b8)", margin: 0 }}>
          Connect your wallet to create a vesting stream.
        </p>
      </div>
    );
  }

  return (
    <article
      aria-label="Create vesting stream"
      style={{
        background: "var(--color-bg-surface, #1E293B)",
        borderRadius: "12px",
        padding: "28px 32px",
        fontFamily: "var(--font-family-base, system-ui, sans-serif)",
        maxWidth: "520px",
        width: "100%",
        color: "var(--color-text-primary, #f8fafc)",
      }}
    >
      {/* Keyframe for spinner */}
      <style>{`
        @keyframes create-stream-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      <StepIndicator current={step} />

      <form onSubmit={step !== "sign" ? handleNext : (e) => e.preventDefault()} noValidate>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {step === "recipient" && (
              <StepRecipient state={state} errors={errors} dispatch={dispatch} />
            )}
            {step === "token" && (
              <StepToken state={state} errors={errors} dispatch={dispatch} />
            )}
            {step === "schedule" && (
              <StepSchedule state={state} errors={errors} dispatch={dispatch} />
            )}
            {step === "review" && <StepReview state={state} />}
            {step === "sign" && (
              <StepSign state={state} signing={signing} signError={signError} />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "28px",
            gap: "12px",
          }}
        >
          {/* Back / Reset */}
          {step !== "recipient" && !state.streamId && (
            <button
              type="button"
              onClick={step === "sign" && state.streamId ? handleReset : handleBack}
              style={{
                background: "transparent",
                border: "1px solid var(--color-border, #475569)",
                borderRadius: "8px",
                color: "var(--color-text-secondary, #94a3b8)",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 600,
                padding: "10px 20px",
              }}
            >
              Back
            </button>
          )}

          {/* Spacer when Back is hidden */}
          {(step === "recipient" || !!state.streamId) && <span />}

          {/* Forward / Sign / Create another */}
          {state.streamId ? (
            <button
              type="button"
              onClick={handleReset}
              style={{
                background: "var(--color-brand-primary, #7C3AED)",
                border: "none",
                borderRadius: "8px",
                color: "#fff",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 700,
                padding: "10px 24px",
              }}
            >
              Create another
            </button>
          ) : step === "sign" ? (
            <button
              type="button"
              onClick={handleSign}
              disabled={signing}
              style={{
                background: signing ? "#475569" : "var(--color-brand-primary, #7C3AED)",
                border: "none",
                borderRadius: "8px",
                color: "#fff",
                cursor: signing ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "14px",
                fontWeight: 700,
                padding: "10px 24px",
                opacity: signing ? 0.8 : 1,
              }}
            >
              {signing && <Spinner />}
              {signing ? "Signing…" : "Sign & Create Stream"}
            </button>
          ) : (
            <button
              type="submit"
              style={{
                background: "var(--color-brand-primary, #7C3AED)",
                border: "none",
                borderRadius: "8px",
                color: "#fff",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 700,
                padding: "10px 24px",
                marginLeft: "auto",
              }}
            >
              {step === "review" ? "Proceed to Sign" : "Continue →"}
            </button>
          )}
        </div>
      </form>
    </article>
  );
}
