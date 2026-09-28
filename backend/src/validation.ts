/**
 * Zod schemas for all API request inputs.
 *
 * Covers:
 *   - Stellar public key (G-prefixed, 56 chars)
 *   - Soroban contract/token address (C-prefixed, 56 chars)
 *   - GET /schedules/:recipient / GET /claimable/:recipient — address params
 *   - POST /streams                — create-stream request body
 *   - GET /schedules/sponsor/:sponsor — sponsor param + pagination query
 *   - GET /streams/:recipient/events  — pagination query
 *   - GET /api/v1/schedules          — paginated sponsor dashboard query
 *   - GET /analytics/sponsor/:address — analytics address param
 *   - GET /schedules/export          — export query params
 *   - POST /api/v1/webhooks          — webhook registration body
 */

import { z } from "zod";

// ── Stellar address primitives ────────────────────────────────────────────────

/**
 * Stellar public key: starts with G, followed by 55 base-32 chars (A-Z, 2-7).
 * Total length: 56 characters.
 */
export const StellarAddressSchema = z
  .string({ required_error: "Stellar address is required" })
  .regex(/^G[A-Z2-7]{55}$/, {
    message:
      "Must be a valid Stellar public key (G followed by 55 base-32 characters)",
  });

/**
 * Soroban contract / token address: starts with C, followed by 55 base-32 chars.
 * Total length: 56 characters.
 */
export const SorobanContractAddressSchema = z
  .string({ required_error: "Contract address is required" })
  .regex(/^C[A-Z2-7]{55}$/, {
    message:
      "Must be a valid Soroban contract address (C followed by 55 base-32 characters)",
  });

// ── Path parameter schemas ────────────────────────────────────────────────────

/** Params for GET /schedules/:recipient and GET /claimable/:recipient */
export const RecipientParamsSchema = z.object({
  recipient: StellarAddressSchema,
});

/** Params for GET /schedules/sponsor/:sponsor */
export const SponsorParamsSchema = z.object({
  sponsor: StellarAddressSchema,
});

/** Params for GET /analytics/sponsor/:address */
export const AddressParamsSchema = z.object({
  address: StellarAddressSchema,
});

// ── Shared pagination query ───────────────────────────────────────────────────

/**
 * Reusable pagination query parameters.
 * All values are strings from the query string and are coerced to numbers.
 */
export const PaginationQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .default("1")
    .pipe(
      z.coerce
        .number({ invalid_type_error: "page must be a number" })
        .int("page must be an integer")
        .min(1, "page must be at least 1"),
    ),
  limit: z
    .string()
    .optional()
    .default("25")
    .pipe(
      z.coerce
        .number({ invalid_type_error: "limit must be a number" })
        .int("limit must be an integer")
        .min(1, "limit must be at least 1")
        .max(100, "limit must not exceed 100"),
    ),
  cursor: z.string().optional(),
});

// ── GET /streams/:recipient/events — event-list pagination ────────────────────

export const EventsQuerySchema = PaginationQuerySchema;

// ── GET /api/v1/schedules — sponsor dashboard ─────────────────────────────────

const STREAM_STATUSES = ["active", "pre_cliff", "expired", "cancelled"] as const;
const SORT_VALUES = [
  "cliff_asc",
  "cliff_desc",
  "end_asc",
  "end_desc",
  "claimable_asc",
  "claimable_desc",
  "recipient_asc",
  "recipient_desc",
] as const;

export const SchedulesQuerySchema = z.object({
  sponsor: StellarAddressSchema,
  status: z.enum(STREAM_STATUSES).optional(),
  sort: z.enum(SORT_VALUES).optional().default("cliff_asc"),
  page: z
    .string()
    .optional()
    .default("1")
    .pipe(
      z.coerce
        .number({ invalid_type_error: "page must be a number" })
        .int("page must be an integer")
        .min(1, "page must be at least 1"),
    ),
  limit: z
    .string()
    .optional()
    .default("25")
    .pipe(
      z.coerce
        .number({ invalid_type_error: "limit must be a number" })
        .int("limit must be an integer")
        .min(1, "limit must be at least 1")
        .max(100, "limit must not exceed 100"),
    ),
  cursor: z.string().optional(),
});

// ── POST /streams — create-stream body ───────────────────────────────────────

export const CreateStreamBodySchema = z.object({
  /** Stellar public key of the sponsor paying the deposit */
  sponsor: StellarAddressSchema,

  /** Stellar public key of the stream recipient */
  recipient: StellarAddressSchema,

  /** Soroban SAC token contract address */
  token: SorobanContractAddressSchema,

  /** Tokens released per ledger — positive integer */
  rate: z
    .number({ required_error: "rate is required", invalid_type_error: "rate must be a number" })
    .int("rate must be an integer")
    .positive("rate must be greater than 0"),

  /** Ledger count from start_ledger until cliff — must be < total_duration */
  cliff_duration: z
    .number({
      required_error: "cliff_duration is required",
      invalid_type_error: "cliff_duration must be a number",
    })
    .int("cliff_duration must be an integer")
    .min(0, "cliff_duration must be non-negative"),

  /** Total stream length in ledgers — must be > cliff_duration */
  total_duration: z
    .number({
      required_error: "total_duration is required",
      invalid_type_error: "total_duration must be a number",
    })
    .int("total_duration must be an integer")
    .positive("total_duration must be greater than 0"),
}).superRefine((data, ctx) => {
  if (data.total_duration <= data.cliff_duration) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["total_duration"],
      message: "total_duration must be greater than cliff_duration",
    });
  }
  if (data.sponsor === data.recipient) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recipient"],
      message: "sponsor and recipient must be different addresses",
    });
  }
});

// ── GET /schedules/export — export query params ───────────────────────────────

export const ExportQuerySchema = z.object({
  format: z
    .enum(["csv", "json"], {
      invalid_type_error: "format must be 'csv' or 'json'",
      required_error: "format is required",
    })
    .optional()
    .default("json"),
  from: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || !isNaN(new Date(v).getTime()),
      { message: "from must be a valid ISO 8601 date string" },
    ),
  to: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || !isNaN(new Date(v).getTime()),
      { message: "to must be a valid ISO 8601 date string" },
    ),
});

// ── POST /api/v1/webhooks — webhook registration ──────────────────────────────

export const SUPPORTED_WEBHOOK_EVENTS = [
  "tokens_claimed",
  "stream_cancelled",
  "stream_created",
  "stream_drained",
  "stream_clawed_back",
] as const;

export type SupportedWebhookEvent = (typeof SUPPORTED_WEBHOOK_EVENTS)[number];

export const WebhookBodySchema = z.object({
  /** Fully-qualified HTTPS URL to deliver event payloads to */
  url: z
    .string({ required_error: "url is required" })
    .url("url must be a valid URL")
    .refine((v) => v.startsWith("https://"), {
      message: "url must use HTTPS",
    }),

  /** One or more event type strings to subscribe to */
  events: z
    .array(
      z.enum(SUPPORTED_WEBHOOK_EVENTS, {
        errorMap: () => ({
          message: `events must contain only supported types: ${SUPPORTED_WEBHOOK_EVENTS.join(", ")}`,
        }),
      }),
    )
    .min(1, "events must contain at least one event type"),

  /** Optional caller-provided HMAC signing secret; generated if omitted */
  secret: z
    .string()
    .min(8, "secret must be at least 8 characters")
    .optional(),
});

// ── Webhook header schema ─────────────────────────────────────────────────────

export const WebhookHeaderSchema = z.object({
  "x-sponsor-id": StellarAddressSchema,
});

// ── Type exports ──────────────────────────────────────────────────────────────

export type RecipientParams = z.infer<typeof RecipientParamsSchema>;
export type SponsorParams = z.infer<typeof SponsorParamsSchema>;
export type AddressParams = z.infer<typeof AddressParamsSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type EventsQuery = z.infer<typeof EventsQuerySchema>;
export type SchedulesQuery = z.infer<typeof SchedulesQuerySchema>;
export type CreateStreamBody = z.infer<typeof CreateStreamBodySchema>;
export type ExportQuery = z.infer<typeof ExportQuerySchema>;
export type WebhookBody = z.infer<typeof WebhookBodySchema>;

// ── Legacy helper (kept for backwards compatibility) ──────────────────────────

/**
 * @deprecated Use StellarAddressSchema.parse() or the validation middleware.
 * Kept to avoid breaking controllers/schedules.ts which imports it directly.
 */
export function validateAddress(value: string): string {
  const result = StellarAddressSchema.safeParse(value);
  if (!result.success) {
    throw new Error("Invalid Stellar address");
  }
  return result.data.trim();
}
