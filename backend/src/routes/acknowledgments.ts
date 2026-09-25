import { Router, type Request, type Response } from "express";
import { Pool } from "pg";
import { validate } from "../middleware/validate.js";
import {
  AcknowledgmentRecipientParamsSchema,
  CreateAcknowledgmentSchema,
} from "../validation.js";

const TABLE = "stream_acknowledgments";

const SELECT_COLUMNS =
  "recipient, sponsor, token, acknowledged_at, skipped_at, signed_message";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export type AcknowledgmentAction = "acknowledge" | "skip";

export interface StreamAcknowledgmentRecord {
  recipient: string;
  sponsor: string;
  token: string;
  acknowledged_at: string | null;
  skipped_at: string | null;
  signed_message: string | null;
  pending: boolean;
}

interface AcknowledgmentRow {
  recipient: string;
  sponsor: string;
  token: string;
  acknowledged_at: Date | string | null;
  skipped_at: Date | string | null;
  signed_message: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function toRecord(row: AcknowledgmentRow): StreamAcknowledgmentRecord {
  const acknowledgedAt = toIso(row.acknowledged_at);
  const skippedAt = toIso(row.skipped_at);
  return {
    recipient: row.recipient,
    sponsor: row.sponsor,
    token: row.token,
    acknowledged_at: acknowledgedAt,
    skipped_at: skippedAt,
    signed_message: row.signed_message,
    pending: acknowledgedAt === null && skippedAt === null,
  };
}

export async function getAcknowledgmentsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { recipient } = req.params as { recipient: string };

  try {
    const result = await getPool().query(
      `SELECT ${SELECT_COLUMNS}
         FROM ${TABLE}
        WHERE recipient = $1
        ORDER BY created_at DESC`,
      [recipient],
    );

    res.json({
      recipient,
      items: (result.rows as AcknowledgmentRow[]).map(toRecord),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[acknowledgments] list failed:", message);
    res.status(500).json({ error: "Failed to retrieve acknowledgments" });
  }
}

export async function upsertAcknowledgmentHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { recipient } = req.params as { recipient: string };
  const { sponsor, token, action, signedMessage } = req.body as {
    sponsor: string;
    token: string;
    action: AcknowledgmentAction;
    signedMessage?: string;
  };

  try {
    const result = await getPool().query(
      `INSERT INTO ${TABLE}
         (recipient, sponsor, token, acknowledged_at, skipped_at, signed_message)
       VALUES (
         $1, $2, $3,
         CASE WHEN $4 = 'acknowledge' THEN now() END,
         CASE WHEN $4 = 'skip' THEN now() END,
         $5
       )
       ON CONFLICT (recipient, sponsor, token) DO UPDATE
         SET acknowledged_at = CASE
               WHEN $4 = 'acknowledge' THEN now()
               ELSE ${TABLE}.acknowledged_at
             END,
             skipped_at = CASE
               WHEN $4 = 'skip' THEN now()
               ELSE ${TABLE}.skipped_at
             END,
             signed_message = COALESCE(
               EXCLUDED.signed_message,
               ${TABLE}.signed_message
             )
       RETURNING ${SELECT_COLUMNS}`,
      [recipient, sponsor, token, action, signedMessage ?? null],
    );

    const row = result.rows[0] as AcknowledgmentRow | undefined;
    if (!row) {
      res.status(500).json({ error: "Failed to store acknowledgment" });
      return;
    }

    res.status(201).json(toRecord(row));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[acknowledgments] upsert failed:", message);
    res.status(500).json({ error: "Failed to store acknowledgment" });
  }
}

const router = Router();

router.get(
  "/streams/:recipient/acknowledgments",
  validate({ params: AcknowledgmentRecipientParamsSchema }),
  getAcknowledgmentsHandler,
);

router.post(
  "/streams/:recipient/acknowledgments",
  validate({
    params: AcknowledgmentRecipientParamsSchema,
    body: CreateAcknowledgmentSchema,
  }),
  upsertAcknowledgmentHandler,
);

export { router as acknowledgmentsRouter };
