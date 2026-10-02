import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex("vesting_streams", ["sponsor_address", "status"], {
    name: "idx_vesting_streams_sponsor_status",
  });
  pgm.createIndex("vesting_streams", ["sponsor_address", "created_at", "id"], {
    name: "idx_vesting_streams_sponsor_created",
  });
  pgm.createIndex("vesting_streams", ["sponsor_address", "end_ledger", "id"], {
    name: "idx_vesting_streams_sponsor_end_ledger",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("vesting_streams", ["sponsor_address", "end_ledger", "id"], {
    name: "idx_vesting_streams_sponsor_end_ledger",
  });
  pgm.dropIndex("vesting_streams", ["sponsor_address", "created_at", "id"], {
    name: "idx_vesting_streams_sponsor_created",
  });
  pgm.dropIndex("vesting_streams", ["sponsor_address", "status"], {
    name: "idx_vesting_streams_sponsor_status",
  });
}