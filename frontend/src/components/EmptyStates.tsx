"use client";

import { useCallback, useId, useState, type ReactNode } from "react";
import { ConfettiBurst } from "@/components/ConfettiBurst";
import { formatAmount } from "@/utils/formatAmount";
import type { StreamCompletionEvidence } from "@/utils/streamCompletion";
import styles from "./EmptyStates.module.css";

export { isExpiredAndFullyClaimed } from "@/utils/streamCompletion";

const COLORS = {
  surface: "var(--color-bg-surface, var(--color-surface, var(--color-neutral-800, #1e293b)))",
  text: "var(--color-text-primary, var(--color-text, var(--color-neutral-900, #0f172a)))",
  secondary: "var(--color-text-secondary, var(--color-text, var(--color-neutral-600, #475569)))",
  primary: "var(--color-brand-primary, var(--color-active, var(--color-primary-600, #7c3aed)))",
  accent: "var(--color-accent, var(--color-secondary-500, #06b6d4))",
  success: "var(--color-success, var(--color-completed, var(--color-success-500, #10b981)))",
  warning: "var(--color-warning, var(--color-pre-cliff, var(--color-warning-500, #f59e0b)))",
  danger: "var(--color-danger, var(--color-cancelled, var(--color-error-500, #ef4444)))",
  contrast: "var(--color-neutral-50, #f8fafc)",
  muted: "var(--color-neutral-300, var(--color-neutral-500, #94a3b8))",
};

export interface EmptyStateProps {
  illustration: ReactNode;
  heading: string;
  subtext?: ReactNode;
  cta?: ReactNode;
  testId?: string;
  stateId?: string;
  className?: string;
}

export function EmptyState({
  illustration,
  heading,
  subtext,
  cta,
  testId = "empty-state",
  stateId,
  className,
}: EmptyStateProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const subtextId = `${id}-subtext`;

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      aria-describedby={subtext ? subtextId : undefined}
      data-testid={testId}
      data-state={stateId}
      className={`${styles.emptyState}${className ? ` ${className}` : ""}`}
    >
      <div className={styles.illustration}>{illustration}</div>
      <h2 id={headingId} className={styles.heading}>
        {heading}
      </h2>
      {subtext && (
        <div id={subtextId} className={styles.subtext}>
          {subtext}
        </div>
      )}
      {cta && <div className={styles.actionGroup}>{cta}</div>}
    </section>
  );
}

function Illustration({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <svg
      width="120"
      height="100"
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
      data-testid={testId}
      focusable="false"
    >
      {children}
    </svg>
  );
}

function StreamsIllustration() {
  return (
    <Illustration
      label="An address card with a share arrow, representing an address ready to share"
      testId="empty-illustration-new-user"
    >
      <circle cx="60" cy="50" r="44" fill={COLORS.primary} fillOpacity="0.08" />
      <rect x="26" y="38" width="46" height="32" rx="6" fill={COLORS.surface} stroke={COLORS.primary} strokeWidth="2" />
      <path d="M34 48H64M34 56H58M34 64H52" stroke={COLORS.secondary} strokeWidth="2" strokeLinecap="round" />
      <circle cx="88" cy="28" r="13" fill={COLORS.accent} />
      <path d="M82 28H94M88 22V34" stroke={COLORS.contrast} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M78 82C88 76 93 68 96 58" stroke={COLORS.primary} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 4" />
      <polyline points="90,58 96,58 96,64" stroke={COLORS.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </Illustration>
  );
}

function SponsorIllustration() {
  return (
    <Illustration
      label="A person beside a growing plant, representing rewards for a team"
      testId="empty-illustration-sponsor"
    >
      <circle cx="60" cy="50" r="44" fill={COLORS.primary} fillOpacity="0.08" />
      <circle cx="46" cy="36" r="9" fill={COLORS.surface} stroke={COLORS.primary} strokeWidth="2" />
      <path d="M32 64C32 53.2 38.2 44 46 44S60 53.2 60 64" stroke={COLORS.primary} strokeWidth="2" strokeLinecap="round" />
      <path d="M60 82V60" stroke={COLORS.success} strokeWidth="3" strokeLinecap="round" />
      <path d="M60 72C69 70 74 63 76 54" stroke={COLORS.success} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M60 68C51 66 46 60 44 52" stroke={COLORS.success} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="76" cy="50" r="3" fill={COLORS.warning} />
      <circle cx="44" cy="48" r="3" fill={COLORS.warning} />
      <path d="M78 82H98" stroke={COLORS.muted} strokeWidth="2" strokeLinecap="round" />
    </Illustration>
  );
}

function HistoryIllustration() {
  return (
    <Illustration
      label="A clock beside a document, representing an empty transaction history"
      testId="empty-illustration-tx-history"
    >
      <circle cx="60" cy="50" r="44" fill={COLORS.accent} fillOpacity="0.08" />
      <rect x="30" y="32" width="42" height="38" rx="4" fill={COLORS.surface} stroke={COLORS.accent} strokeWidth="2" />
      <path d="M38 44H64M38 52H58M38 60H62" stroke={COLORS.secondary} strokeWidth="2" strokeLinecap="round" />
      <circle cx="86" cy="34" r="13" fill={COLORS.surface} stroke={COLORS.accent} strokeWidth="2" />
      <path d="M86 27V34L91 38" stroke={COLORS.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Illustration>
  );
}

function SearchIllustration() {
  return (
    <Illustration
      label="A magnifying glass over an address card with a cross, representing no search results"
      testId="empty-illustration-search"
    >
      <circle cx="60" cy="50" r="44" fill={COLORS.danger} fillOpacity="0.07" />
      <rect x="28" y="32" width="50" height="32" rx="5" fill={COLORS.surface} stroke={COLORS.secondary} strokeWidth="2" />
      <path d="M36 44H66M36 52H56" stroke={COLORS.muted} strokeWidth="2" strokeLinecap="round" />
      <circle cx="72" cy="46" r="18" fill={COLORS.surface} stroke={COLORS.danger} strokeWidth="2.5" />
      <line x1="85" y1="59" x2="98" y2="72" stroke={COLORS.danger} strokeWidth="3" strokeLinecap="round" />
      <line x1="65" y1="39" x2="79" y2="53" stroke={COLORS.danger} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="79" y1="39" x2="65" y2="53" stroke={COLORS.danger} strokeWidth="2.5" strokeLinecap="round" />
    </Illustration>
  );
}

function NotificationIllustration() {
  return (
    <Illustration
      label="A bell with a check mark, representing caught-up notifications"
      testId="empty-illustration-notifications"
    >
      <circle cx="60" cy="50" r="44" fill={COLORS.success} fillOpacity="0.08" />
      <path d="M42 65C47 60 47 52 47 43C47 32.5 52.8 25 60 25C67.2 25 73 32.5 73 43C73 52 73 60 78 65" fill={COLORS.surface} stroke={COLORS.success} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40 65H80" stroke={COLORS.success} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M55 71C56.3 74 58.6 76 60 76C61.4 76 63.7 74 65 71" stroke={COLORS.success} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M50 52L57 59L71 43" stroke={COLORS.warning} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="84" cy="30" r="7" fill={COLORS.warning} />
      <path d="M84 27V30L86 32" stroke={COLORS.contrast} strokeWidth="1.5" strokeLinecap="round" />
    </Illustration>
  );
}

function CompletionIllustration() {
  return (
    <Illustration
      label="A trophy with stars and tokens, representing a fully claimed stream"
      testId="empty-illustration-completed"
    >
      <circle cx="60" cy="50" r="44" fill={COLORS.success} fillOpacity="0.1" />
      <path d="M40 30H80V48C80 59 71 66 60 66C49 66 40 59 40 48V30Z" fill={COLORS.surface} stroke={COLORS.success} strokeWidth="2.5" />
      <path d="M40 36H31C31 44 34 48 42 50M80 36H89C89 44 86 48 78 50" stroke={COLORS.success} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M52 66H68L72 78H48L52 66Z" fill={COLORS.warning} stroke={COLORS.success} strokeWidth="2" />
      <path d="M44 80H76" stroke={COLORS.success} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M60 36L63 43L71 44L65 49L67 57L60 53L53 57L55 49L49 44L57 43L60 36Z" fill={COLORS.warning} stroke={COLORS.success} strokeWidth="1.5" />
      <circle cx="26" cy="28" r="3" fill={COLORS.accent} />
      <circle cx="94" cy="26" r="3" fill={COLORS.accent} />
    </Illustration>
  );
}

export type ShareAddressResult = "shared" | "copied" | "cancelled" | "unavailable";

interface SharePayload {
  title?: string;
  text?: string;
  url?: string;
}

type ShareNavigator = Navigator & {
  share?: (data: SharePayload) => Promise<void>;
};

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export async function shareAddress(address: string): Promise<ShareAddressResult> {
  const value = address.trim();
  if (!value) return "unavailable";

  if (typeof navigator !== "undefined") {
    const share = (navigator as ShareNavigator).share;
    if (typeof share === "function") {
      try {
        await share.call(navigator, { title: "My vesting address", text: value });
        return "shared";
      } catch (error) {
        if (isAbortError(error)) return "cancelled";
      }
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return "copied";
      } catch {
        return "unavailable";
      }
    }
  }

  return "unavailable";
}

export interface NewUserEmptyProps {
  address?: string | null;
}

export function NewUserEmpty({ address }: NewUserEmptyProps) {
  const [shareResult, setShareResult] = useState<ShareAddressResult | null>(null);

  const handleShare = useCallback(async () => {
    const result = await shareAddress(address ?? "");
    setShareResult(result);
  }, [address]);

  const statusMessage = shareResult
    ? {
        shared: "Address shared.",
        copied: "Address copied to your clipboard.",
        cancelled: "Sharing was cancelled.",
        unavailable: "Copy your wallet address to share it manually.",
      }[shareResult]
    : undefined;

  return (
    <EmptyState
      testId="empty-state" stateId="new-user"
      illustration={<StreamsIllustration />}
      heading="You have no vesting streams yet. Ask your sponsor to create one."
      subtext="Share your address so your sponsor knows where to send your vesting stream."
      cta={
        <>
          {address && (
            <code className={styles.address} aria-label={`Address to share: ${address}`}>
              {address}
            </code>
          )}
          <button
            type="button"
            className={`${styles.action} btn btn-primary btn--primary`}
            onClick={handleShare}
            data-testid="share-address"
          >
            Share your address
          </button>
          {statusMessage && (
            <span
              className={styles.status}
              role="status"
              aria-live="polite"
              data-tone={shareResult === "unavailable" ? "error" : "success"}
            >
              {statusMessage}
            </span>
          )}
        </>
      }
    />
  );
}

export interface SponsorEmptyProps {
  onCreateStream?: () => void;
  testId?: string;
}

export function SponsorStreamListEmpty({
  onCreateStream,
  testId = "empty-create-stream",
}: SponsorEmptyProps) {
  const cta = onCreateStream ? (
    <button
      type="button"
      className={`${styles.action} btn btn-primary btn--primary`}
      onClick={onCreateStream}
      data-testid={testId}
    >
      Create Stream
    </button>
  ) : (
    <a
      href="/"
      className={`${styles.action} btn btn-primary btn--primary`}
      data-testid={testId}
    >
      Create Stream
    </a>
  );

  return (
    <EmptyState
      testId="empty-state" stateId="sponsor"
      illustration={<SponsorIllustration />}
      heading="Start rewarding your team with vesting"
      subtext="Create a stream to set clear expectations and keep contributors aligned."
      cta={cta}
    />
  );
}

export function TxHistoryEmpty() {
  return (
    <EmptyState
      testId="empty-state" stateId="tx-history"
      illustration={<HistoryIllustration />}
      heading="No transactions yet"
      subtext="Transactions you submit — claims, stream creation, and cancellations — will appear here once you start interacting with the contract."
      cta={
        <a
          href="https://stellar.expert/explorer/testnet"
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.action} btn btn-outline btn--secondary`}
          data-testid="empty-explore-stellar"
        >
          Explore Stellar Expert ↗
        </a>
      }
    />
  );
}

export interface SearchEmptyProps {
  onResetFilter?: () => void;
  address?: string | null;
  ctaLabel?: string;
}

export function SearchResultsEmpty({
  onResetFilter,
  address,
  ctaLabel = "Try another address",
}: SearchEmptyProps) {
  const cta = onResetFilter ? (
    <button
      type="button"
      className={`${styles.action} btn btn-outline btn--secondary`}
      onClick={onResetFilter}
      data-testid="empty-reset-filter"
    >
      Reset filter
    </button>
  ) : (
    <a href="/" className={`${styles.action} btn btn-outline btn--secondary`} data-testid="empty-try-another-address">
      {ctaLabel}
    </a>
  );

  return (
    <EmptyState
      testId="empty-state" stateId="search"
      illustration={<SearchIllustration />}
      heading="No streams found for this address. Double-check the address or try a different one."
      subtext={address ? `No vesting streams were found for ${address}.` : undefined}
      cta={cta}
    />
  );
}

export interface RecipientEmptyProps {
  onContactSponsor?: () => void;
  address?: string | null;
}

export function RecipientScheduleEmpty({ onContactSponsor, address }: RecipientEmptyProps) {
  return (
    <EmptyState
      testId="empty-state" stateId="recipient"
      illustration={<SearchIllustration />}
      heading="No schedule found"
      subtext={
        address
          ? `There's no active vesting stream for ${address}. Ask your sponsor to create one, or double-check you're connected with the right wallet.`
          : "There's no active vesting stream for your wallet address. Ask your sponsor to create one, or double-check you're connected with the right wallet."
      }
      cta={
        onContactSponsor ? (
          <button
            type="button"
            className={`${styles.action} btn btn-primary btn--primary`}
            onClick={onContactSponsor}
            data-testid="empty-contact-sponsor"
          >
            Contact sponsor
          </button>
        ) : (
          <a
            href="https://docs.stellar.org"
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.action} btn btn-outline btn--secondary`}
            data-testid="empty-learn-more"
          >
            Learn about vesting ↗
          </a>
        )
      }
    />
  );
}

export function SponsorDashboardEmpty({ onCreateStream }: SponsorEmptyProps = {}) {
  return <SponsorStreamListEmpty onCreateStream={onCreateStream} />;
}

export function NotificationsEmpty() {
  return (
    <EmptyState
      testId="empty-state" stateId="notifications"
      illustration={<NotificationIllustration />}
      heading="All caught up! We'll notify you when something happens."
    />
  );
}

export const NotificationEmpty = NotificationsEmpty;

export interface ExpiredFullyClaimedProps {
  token: string;
  totalReceived: number;
  recipient?: string;
  celebrate?: boolean;
  onViewStreams?: () => void;
}

export function ExpiredFullyClaimedState({
  token,
  totalReceived,
  recipient,
  celebrate = false,
  onViewStreams,
}: ExpiredFullyClaimedProps) {
  const [celebrating, setCelebrating] = useState(celebrate);
  const formatted = formatAmount(Number.isFinite(totalReceived) ? totalReceived : 0);

  const cta = onViewStreams ? (
    <button
      type="button"
      className={`${styles.action} btn btn-primary btn--primary`}
      onClick={onViewStreams}
      data-testid="empty-view-streams"
    >
      View my streams
    </button>
  ) : (
    <a href="/streams" className={`${styles.action} btn btn-primary btn--primary`} data-testid="empty-view-streams">
      View my streams
    </a>
  );

  return (
    <>
      <ConfettiBurst active={celebrating} onDone={() => setCelebrating(false)} />
      <EmptyState
        testId="empty-state" stateId="completed"
        className={styles.celebration}
        illustration={<CompletionIllustration />}
        heading="Stream complete"
        subtext={
          <div className={styles.completionSummary}>
            <span className={styles.completionLabel}>Total received</span>
            <span
              className={styles.completionAmount}
              data-testid="completed-total-received"
              aria-label={`Total received: ${formatted} ${token}`}
            >
              {formatted} {token}
            </span>
            <span className={styles.completionLabel}>
              {recipient ? `Received by ${recipient}. ` : ""}This stream has expired. Every vested token has been claimed.
            </span>
          </div>
        }
        cta={cta}
      />
    </>
  );
}

export const NewUserEmptyState = NewUserEmpty;
export const NoStreamsEmpty = NewUserEmpty;
export const NoNotificationsEmpty = NotificationsEmpty;
export const NoSearchResultsEmpty = SearchResultsEmpty;
export const StreamCompleteEmpty = ExpiredFullyClaimedState;
export type { StreamCompletionEvidence };

// ─── New empty-state components (5 required scenarios) ───────────────────────

/** Illustration: inbox tray with a person walking toward a stream source */
function RecipientNoStreamsIllustration() {
  return (
    <Illustration
      label="An inbox with no streams and a person walking toward a flow source"
      testId="empty-illustration-recipient-no-streams"
    >
      {/* background glow */}
      <circle cx="60" cy="50" r="44" fill={COLORS.primary} fillOpacity="0.09" />
      {/* inbox tray */}
      <rect x="22" y="46" width="52" height="28" rx="5" fill={COLORS.surface} stroke={COLORS.primary} strokeWidth="2" />
      <path d="M22 58H40L44 52H52L56 58H74" stroke={COLORS.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* empty lines inside tray */}
      <path d="M32 64H44M52 64H64" stroke={COLORS.muted} strokeWidth="1.5" strokeLinecap="round" />
      {/* flowing stream / arrow */}
      <path d="M60 22C60 22 68 30 68 38" stroke={COLORS.accent} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3" />
      <polyline points="63,35 68,38 73,35" stroke={COLORS.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* person figure */}
      <circle cx="35" cy="28" r="7" fill={COLORS.surface} stroke={COLORS.primary} strokeWidth="2" />
      <path d="M28 46C28 38 35 34 35 34C35 34 42 38 42 46" stroke={COLORS.primary} strokeWidth="2" strokeLinecap="round" />
      {/* dashed path toward stream */}
      <path d="M42 40C48 38 54 36 60 36" stroke={COLORS.muted} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3" />
    </Illustration>
  );
}

/** Illustration: rocket launching from a launch pad */
function SponsorCreateStreamIllustration() {
  return (
    <Illustration
      label="A rocket launching from a pad, representing creating a new vesting stream"
      testId="empty-illustration-sponsor-create-stream"
    >
      {/* background glow */}
      <circle cx="60" cy="50" r="44" fill={COLORS.primary} fillOpacity="0.09" />
      {/* launch pad */}
      <rect x="44" y="76" width="32" height="6" rx="3" fill={COLORS.muted} />
      <rect x="52" y="72" width="16" height="6" rx="2" fill={COLORS.secondary} />
      {/* rocket body */}
      <path d="M60 24L70 52H50L60 24Z" fill={COLORS.surface} stroke={COLORS.primary} strokeWidth="2" strokeLinejoin="round" />
      {/* rocket window */}
      <circle cx="60" cy="42" r="5" fill={COLORS.surface} stroke={COLORS.accent} strokeWidth="2" />
      {/* fins */}
      <path d="M50 52L44 62H50V52Z" fill={COLORS.primary} fillOpacity="0.5" />
      <path d="M70 52L76 62H70V52Z" fill={COLORS.primary} fillOpacity="0.5" />
      {/* exhaust flame */}
      <path d="M55 72C55 72 58 80 60 82C62 80 65 72 65 72" fill={COLORS.warning} fillOpacity="0.9" />
      <path d="M57 72C57 72 59 76 60 78C61 76 63 72 63 72" fill={COLORS.danger} fillOpacity="0.7" />
      {/* stars */}
      <circle cx="28" cy="28" r="2" fill={COLORS.accent} />
      <circle cx="92" cy="34" r="2" fill={COLORS.warning} />
      <circle cx="86" cy="20" r="1.5" fill={COLORS.accent} fillOpacity="0.7" />
    </Illustration>
  );
}

/** Illustration: timeline / event log with a clock and a "just started" marker */
function EventHistoryNewIllustration() {
  return (
    <Illustration
      label="A timeline with a clock showing a stream was just created"
      testId="empty-illustration-event-history-new"
    >
      {/* background glow */}
      <circle cx="60" cy="50" r="44" fill={COLORS.accent} fillOpacity="0.08" />
      {/* vertical timeline axis */}
      <line x1="40" y1="22" x2="40" y2="80" stroke={COLORS.muted} strokeWidth="2" strokeLinecap="round" />
      {/* single event dot at top — the stream creation event */}
      <circle cx="40" cy="30" r="6" fill={COLORS.surface} stroke={COLORS.accent} strokeWidth="2" />
      <circle cx="40" cy="30" r="2.5" fill={COLORS.accent} />
      {/* event label line */}
      <path d="M48 30H72" stroke={COLORS.secondary} strokeWidth="1.5" strokeLinecap="round" />
      <rect x="72" y="22" width="28" height="16" rx="4" fill={COLORS.surface} stroke={COLORS.accent} strokeWidth="1.5" />
      <path d="M76 30H96" stroke={COLORS.muted} strokeWidth="1.5" strokeLinecap="round" />
      {/* future dots (faded) */}
      <circle cx="40" cy="50" r="5" fill={COLORS.surface} stroke={COLORS.muted} strokeWidth="1.5" strokeDasharray="3 2" />
      <circle cx="40" cy="68" r="5" fill={COLORS.surface} stroke={COLORS.muted} strokeWidth="1.5" strokeDasharray="3 2" />
      {/* clock */}
      <circle cx="88" cy="72" r="14" fill={COLORS.surface} stroke={COLORS.primary} strokeWidth="2" />
      <path d="M88 63V72L93 77" stroke={COLORS.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Illustration>
  );
}

/** Illustration: magnifying glass with a funnel and a cross */
function SearchFilterIllustration() {
  return (
    <Illustration
      label="A magnifying glass overlapping a filter funnel with a cross, representing no filter matches"
      testId="empty-illustration-search-filter"
    >
      {/* background glow */}
      <circle cx="60" cy="50" r="44" fill={COLORS.warning} fillOpacity="0.07" />
      {/* filter funnel */}
      <path d="M22 26H58L46 46V68L34 62V46Z" fill={COLORS.surface} stroke={COLORS.secondary} strokeWidth="2" strokeLinejoin="round" />
      <path d="M26 32H54" stroke={COLORS.muted} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M30 38H50" stroke={COLORS.muted} strokeWidth="1.5" strokeLinecap="round" />
      {/* magnifying glass */}
      <circle cx="80" cy="52" r="18" fill={COLORS.surface} stroke={COLORS.danger} strokeWidth="2.5" />
      <line x1="93" y1="65" x2="104" y2="76" stroke={COLORS.danger} strokeWidth="3" strokeLinecap="round" />
      {/* X inside lens */}
      <line x1="73" y1="45" x2="87" y2="59" stroke={COLORS.danger} strokeWidth="2.5" strokeLinecap="round" />
      <line x1="87" y1="45" x2="73" y2="59" stroke={COLORS.danger} strokeWidth="2.5" strokeLinecap="round" />
    </Illustration>
  );
}

/** Illustration: wallet with a lock and a connection plug */
function WalletDisconnectedIllustration() {
  return (
    <Illustration
      label="A wallet with a lock and a disconnected plug, representing a wallet not connected"
      testId="empty-illustration-wallet-disconnected"
    >
      {/* background glow */}
      <circle cx="60" cy="50" r="44" fill={COLORS.warning} fillOpacity="0.09" />
      {/* wallet body */}
      <rect x="24" y="36" width="56" height="38" rx="7" fill={COLORS.surface} stroke={COLORS.primary} strokeWidth="2" />
      <rect x="24" y="36" width="56" height="16" rx="7" fill={COLORS.primary} fillOpacity="0.15" />
      {/* wallet pocket */}
      <rect x="64" y="48" width="20" height="14" rx="5" fill={COLORS.surface} stroke={COLORS.primary} strokeWidth="1.5" />
      <circle cx="74" cy="55" r="3" fill={COLORS.primary} fillOpacity="0.4" />
      {/* lock badge */}
      <circle cx="38" cy="34" r="12" fill={COLORS.surface} stroke={COLORS.warning} strokeWidth="2" />
      <path d="M33 34C33 31.2 35.2 29 38 29C40.8 29 43 31.2 43 34H33Z" fill={COLORS.warning} />
      <rect x="32" y="34" width="12" height="8" rx="2" fill={COLORS.warning} />
      <circle cx="38" cy="38" r="1.5" fill={COLORS.contrast} />
      {/* disconnected plug cable */}
      <path d="M72 22V30" stroke={COLORS.muted} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="3 3" />
      <path d="M68 28H76" stroke={COLORS.muted} strokeWidth="2.5" strokeLinecap="round" />
    </Illustration>
  );
}

// ── RecipientEmpty ────────────────────────────────────────────────────────────

/** Recipient dashboard: no active streams yet */
export function RecipientEmpty() {
  return (
    <EmptyState
      testId="empty-state"
      stateId="recipient-no-streams"
      illustration={<RecipientNoStreamsIllustration />}
      heading="You have no active streams."
      subtext="Share your address with a sponsor to get started."
    />
  );
}

// ── SponsorEmpty ──────────────────────────────────────────────────────────────

export interface SponsorEmptyCreateProps {
  onCreateStream?: () => void;
}

/** Sponsor dashboard: no streams created yet */
export function SponsorEmpty({ onCreateStream }: SponsorEmptyCreateProps = {}) {
  const cta = onCreateStream ? (
    <button
      type="button"
      className={`${styles.action} btn btn-primary btn--primary`}
      onClick={onCreateStream}
      data-testid="sponsor-empty-create-stream"
    >
      Create your first vesting stream
    </button>
  ) : (
    <a
      href="/"
      className={`${styles.action} btn btn-primary btn--primary`}
      data-testid="sponsor-empty-create-stream"
    >
      Create your first vesting stream
    </a>
  );

  return (
    <EmptyState
      testId="empty-state"
      stateId="sponsor-no-streams"
      illustration={<SponsorCreateStreamIllustration />}
      heading="No vesting streams yet."
      subtext="Start rewarding your contributors with predictable, cliff-locked vesting."
      cta={cta}
    />
  );
}

// ── EventHistoryEmpty ─────────────────────────────────────────────────────────

/** Stream event history: stream was just created, no events recorded yet */
export function EventHistoryEmpty() {
  return (
    <EmptyState
      testId="empty-state"
      stateId="event-history-empty"
      illustration={<EventHistoryNewIllustration />}
      heading="Stream just created — events will appear as activity occurs."
      subtext="Claims, cancellations, and other on-chain actions will show up here once they happen."
    />
  );
}

// ── SearchEmpty ───────────────────────────────────────────────────────────────

export interface SearchEmptyFilterProps {
  onClearFilters?: () => void;
}

/** Search / filter panel: active filters returned no results */
export function SearchEmpty({ onClearFilters }: SearchEmptyFilterProps = {}) {
  const cta = onClearFilters ? (
    <button
      type="button"
      className={`${styles.action} btn btn-outline btn--secondary`}
      onClick={onClearFilters}
      data-testid="search-empty-clear-filters"
    >
      Clear filters
    </button>
  ) : (
    <button
      type="button"
      className={`${styles.action} btn btn-outline btn--secondary`}
      data-testid="search-empty-clear-filters"
      disabled
    >
      Clear filters
    </button>
  );

  return (
    <EmptyState
      testId="empty-state"
      stateId="search-no-results"
      illustration={<SearchFilterIllustration />}
      heading="No streams match your filters."
      subtext="Try adjusting or removing your filters to see more results."
      cta={cta}
    />
  );
}

// ── WalletNotConnectedEmpty ───────────────────────────────────────────────────

export interface WalletNotConnectedEmptyProps {
  onConnect?: () => void;
}

/** Wallet not connected: prompt the user to connect */
export function WalletNotConnectedEmpty({ onConnect }: WalletNotConnectedEmptyProps = {}) {
  const cta = onConnect ? (
    <button
      type="button"
      className={`${styles.action} btn btn-primary btn--primary`}
      onClick={onConnect}
      data-testid="wallet-empty-connect"
    >
      Connect wallet
    </button>
  ) : (
    <button
      type="button"
      className={`${styles.action} btn btn-primary btn--primary`}
      data-testid="wallet-empty-connect"
      disabled
    >
      Connect wallet
    </button>
  );

  return (
    <EmptyState
      testId="empty-state"
      stateId="wallet-not-connected"
      illustration={<WalletDisconnectedIllustration />}
      heading="Connect your wallet to view your streams."
      subtext="Connect your Stellar wallet to see your vesting streams and claim your tokens."
      cta={cta}
    />
  );
}
