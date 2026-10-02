/**
 * migrations/003_add_cancelled_at_to_streams.ts
 *
 * Adds `cancelled_at` and `refunded_amount` columns to `vesting_streams`
 * to record cancellation details without a separate table.
 */

import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("vesting_streams", {
    cancelled_at: { type: "timestamptz", notNull: false },
    refunded_amount: { type: "bigint", notNull: false },
    cancellation_tx_hash: { type: "varchar(64)", notNull: false, unique: true },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("vesting_streams", "cancelled_at");
  pgm.dropColumn("vesting_streams", "refunded_amount");
  pgm.dropColumn("vesting_streams", "cancellation_tx_hash");
}
