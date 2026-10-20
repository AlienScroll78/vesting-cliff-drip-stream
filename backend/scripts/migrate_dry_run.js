import { Pool } from "pg";

const upgradeLedger = Number.parseInt(process.env.SCHEMA_V2_LEDGER ?? "", 10);
if (!Number.isSafeInteger(upgradeLedger) || upgradeLedger < 1) {
  console.error("SCHEMA_V2_LEDGER must be a positive ledger sequence.");
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `WITH latest_events AS (
         SELECT DISTINCT ON (recipient)
                recipient, event_type, ledger_sequence, transaction_hash
         FROM stream_events
         ORDER BY recipient, ledger_sequence DESC, created_at DESC
       )
       SELECT recipient, ledger_sequence, event_type, transaction_hash
       FROM latest_events
       WHERE event_type IN ('vc_create', 'stream_created')
         AND ledger_sequence < $1
       ORDER BY ledger_sequence, recipient`,
      [upgradeLedger]
    );

    console.log(`Schema V2 upgrade ledger: ${upgradeLedger}`);
    console.log(`Likely pre-upgrade schedule candidates: ${rows.length}`);
    for (const row of rows) {
      console.log(
        `${row.recipient}\tledger=${row.ledger_sequence}\tevent=${row.event_type}\ttx=${row.transaction_hash}`
      );
    }
    console.log(
      "Estimate only: Soroban contract storage cannot be enumerated from this index."
    );
  } catch (error) {
    console.error("Migration dry-run query failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
