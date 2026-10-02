import { Router, type Request, type Response } from "express";
import { Pool } from "pg";
import { validate } from "../middleware/validate.js";
import { SponsorStreamsQuerySchema } from "../validation.js";

type StreamStatus = "active" | "cancelled" | "expired" | "drained" | "all";
type StreamSort = "created_at" | "end_ledger";

interface StreamCursor {
  sponsor: string;
  status: StreamStatus;
  sort: StreamSort;
  page: number;
  id: string;
  created_at: string;
  end_ledger: number;
}

let pool: Pool | undefined;

function getPool(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function encodeCursor(cursor: StreamCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): StreamCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof parsed.sponsor === "string" &&
      ["active", "cancelled", "expired", "drained", "all"].includes(parsed.status) &&
      ["created_at", "end_ledger"].includes(parsed.sort) &&
      Number.isInteger(parsed.page) && parsed.page > 0 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id) &&
      typeof parsed.created_at === "string" && Number.isFinite(Date.parse(parsed.created_at)) &&
      Number.isInteger(parsed.end_ledger)
    ) {
      return parsed as StreamCursor;
    }
  } catch {
    // Invalid cursors are rejected by the route.
  }
  return null;
}

async function listSponsorStreams(req: Request, res: Response): Promise<void> {
  const { sponsor, status, sort, page, limit, cursor } = req.query as unknown as {
    sponsor: string;
    status: StreamStatus;
    sort: StreamSort;
    page: number;
    limit: number;
    cursor?: string;
  };

  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && (!decoded || decoded.sponsor !== sponsor || decoded.status !== status || decoded.sort !== sort)) {
    res.status(400).json({ error: "Invalid cursor for sponsor, status, or sort" });
    return;
  }

  const filters = ["sponsor_address = $1"];
  const values: unknown[] = [sponsor];
  if (status !== "all") {
    if (status === "expired") {
      filters.push("status IN ('expired', 'completed')");
    } else {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }
  }

  if (decoded) {
    values.push(decoded.sort === "created_at" ? decoded.created_at : decoded.end_ledger);
    const anchor = `$${values.length}`;
    values.push(decoded.id);
    const id = `$${values.length}`;
    filters.push(decoded.sort === "created_at"
      ? `(created_at, id) < (${anchor}::timestamptz, ${id}::uuid)`
      : `(end_ledger, id) < (${anchor}::integer, ${id}::uuid)`);
  }

  const where = filters.join(" AND ");
  const orderColumn = sort === "end_ledger" ? "end_ledger" : "created_at";
  const currentPage = decoded?.page ?? page;
  const offset = decoded ? undefined : (page - 1) * limit;

  try {
    const database = getPool();
    const countSql = `SELECT COUNT(*)::text AS total FROM vesting_streams WHERE ${
      status === "all" ? "sponsor_address = $1"
        : status === "expired" ? "sponsor_address = $1 AND status IN ('expired', 'completed')"
          : "sponsor_address = $1 AND status = $2"
    }`;
    const countValues = status === "all" || status === "expired" ? [sponsor] : [sponsor, status];
    const pagination = decoded
      ? `LIMIT $${values.length + 1}`
      : `LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    const queryValues = [...values, limit + 1];
    if (offset !== undefined) queryValues.push(offset);

    const [countResult, streamResult] = await Promise.all([
      database.query(countSql, countValues),
      database.query(
        `SELECT id, recipient_address AS recipient, sponsor_address AS sponsor,
                token_address AS token, rate_per_ledger::text AS rate_per_ledger,
                start_ledger, cliff_ledger, end_ledger,
                CASE WHEN status = 'completed' THEN 'expired' ELSE status END AS status,
                created_at
         FROM vesting_streams
         WHERE ${where}
         ORDER BY ${orderColumn} DESC, id DESC
         ${pagination}`,
        queryValues,
      ),
    ]);

    const hasMore = streamResult.rows.length > limit;
    const streams = streamResult.rows.slice(0, limit);
    const last = streams.at(-1);
    const nextCursor = hasMore && last
      ? encodeCursor({
          sponsor,
          status,
          sort,
          page: currentPage + 1,
          id: last.id,
          created_at: new Date(last.created_at).toISOString(),
          end_ledger: last.end_ledger,
        })
      : null;

    res.status(200).json({
      streams: streams.map(({ id: _id, ...stream }) => stream),
      total: Number(countResult.rows[0]?.total ?? 0),
      page: currentPage,
      limit,
      next_cursor: nextCursor,
    });
  } catch (error) {
    res.status(500).json({ error: "Unable to list streams" });
  }
}

export const sponsorStreamsRouter = Router();
sponsorStreamsRouter.get("/", validate({ query: SponsorStreamsQuerySchema }), listSponsorStreams);

export { decodeCursor, encodeCursor, listSponsorStreams };