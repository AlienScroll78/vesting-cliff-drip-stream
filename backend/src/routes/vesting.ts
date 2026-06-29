/**
 * Issue #26 — REST API for vesting schedule queries.
 *
 * GET /schedules/:recipient          → full schedule + claimable
 * GET /schedules/sponsor/:sponsor    → paginated list (by sponsor field)
 * GET /claimable/:recipient          → claimable amount only
 *
 * All view calls are simulated via Soroban RPC (no signing required).
 */

import { Router, Request, Response } from "express";
import { networkConfig } from "../config/network.js";

// Lazy-load SDK so unit tests can mock it without the full package installed.
async function getSdk() {
  // @ts-ignore — optional peer dep
  return await import("@stellar/stellar-sdk");
}

const router = Router();

/** Build a dummy account object accepted by TransactionBuilder. */
function dummyAccount(address: string) {
  return {
    accountId: () => address,
    sequenceNumber: () => "0",
    incrementSequenceNumber: () => {},
  };
}

/** Simulate a single no-auth contract call and return the raw retval. */
async function simulateCall(
  sdk: any,
  server: any,
  contractId: string,
  method: string,
  ...args: any[]
) {
  const contract = new sdk.Contract(contractId);
  const tx = new sdk.TransactionBuilder(dummyAccount(args[0]?.toString() ?? "GADUMMY"), {
    fee: sdk.BASE_FEE,
    networkPassphrase: networkConfig.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(15)
    .build();
  return server.simulateTransaction(tx);
}

/** Parse the map ScVal returned by get_schedule into a plain object. */
function parseScheduleMap(sdk: any, mapVal: any) {
  const entries: any[] = mapVal.value().value();
  const field = (name: string) =>
    entries.find((e: any) => e.key().value().toString() === name)?.val();

  return {
    sponsor: field("sponsor")?.value()?.toString() ?? "",
    token: field("token")?.value()?.toString() ?? "",
    rate: field("rate_per_ledger")?.value()?.toString() ?? "0",
    cliff_ledger: Number(field("cliff_ledger")?.value() ?? 0),
    end_ledger: Number(field("end_ledger")?.value() ?? 0),
    start_ledger: Number(field("start_ledger")?.value() ?? 0),
  };
}

// ── GET /schedules/:recipient ─────────────────────────────────────────────────

router.get("/schedules/:recipient", async (req: Request, res: Response) => {
  const { recipient } = req.params;
  try {
    const sdk = await getSdk();
    const server = new sdk.SorobanRpc.Server(networkConfig.rpcUrl);
    const contractId = networkConfig.contractId;

    const [scheduleSim, claimSim, latestLedger] = await Promise.all([
      simulateCall(
        sdk, server, contractId, "get_schedule",
        sdk.Address.fromString(recipient).toScVal()
      ),
      simulateCall(
        sdk, server, contractId, "claimable_amount",
        sdk.Address.fromString(recipient).toScVal()
      ),
      server.getLatestLedger(),
    ]);

    const retval = scheduleSim.result?.retval;
    if (!retval || retval.switch().name === "scvVoid") {
      res.status(404).json({ error: "schedule not found" });
      return;
    }

    const schedule = parseScheduleMap(sdk, retval);
    const claimable = claimSim.result?.retval?.value()?.toString() ?? "0";

    res.json({
      recipient,
      ...schedule,
      claimable_amount: claimable,
      is_cliff_passed: latestLedger.sequence >= schedule.cliff_ledger,
    });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

// ── GET /claimable/:recipient ─────────────────────────────────────────────────

router.get("/claimable/:recipient", async (req: Request, res: Response) => {
  const { recipient } = req.params;
  try {
    const sdk = await getSdk();
    const server = new sdk.SorobanRpc.Server(networkConfig.rpcUrl);

    const sim = await simulateCall(
      sdk, server, networkConfig.contractId, "claimable_amount",
      sdk.Address.fromString(recipient).toScVal()
    );

    const amount = sim.result?.retval?.value()?.toString() ?? "0";
    res.json({ recipient, claimable_amount: amount });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

// ── GET /schedules/sponsor/:sponsor ──────────────────────────────────────────
// Queries the Horizon event stream for StreamCreated events emitted by sponsor
// and returns paginated schedule summaries.

router.get("/schedules/sponsor/:sponsor", async (req: Request, res: Response) => {
  const { sponsor } = req.params;
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) ?? "20", 10)));

  try {
    const horizonUrl = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
    const contractId = networkConfig.contractId;

    // Fetch contract events from Horizon for this contract, filter by topic (sponsor address).
    const url = new URL(`${horizonUrl}/contracts/${contractId}/events`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("order", "desc");
    if (req.query.cursor) url.searchParams.set("cursor", req.query.cursor as string);

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      res.status(502).json({ error: "horizon unavailable" });
      return;
    }

    const data: any = await resp.json();
    const records: any[] = data._embedded?.records ?? [];

    // Filter for stream_created events where topic[1] is the sponsor address.
    const items = records
      .filter((r: any) => {
        const topics: string[] = r.topic ?? [];
        return topics[0]?.includes("stream_created") && topics[1] === sponsor;
      })
      .map((r: any) => ({
        recipient: r.topic?.[2] ?? "",
        sponsor,
        token: r.value?.xdr ?? "",
        ledger: r.ledger,
        event_id: r.id,
      }));

    const nextCursor = records[records.length - 1]?.paging_token ?? null;
    res.json({ items, page, limit, next_cursor: nextCursor });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
});

export { router as vestingRouter };
