import { MigrationBuilder, ColumnDefinitions } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("stream_acknowledgments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
      notNull: true,
    },
    recipient: {
      type: "varchar(56)",
      notNull: true,
      comment: "Stellar G... address of the stream beneficiary",
    },
    sponsor: {
      type: "varchar(56)",
      notNull: true,
      comment: "Stellar G... address of the stream creator",
    },
    token: {
      type: "varchar(56)",
      notNull: true,
      comment: "Token symbol or SAC contract address the stream pays out",
    },
    acknowledged_at: {
      type: "timestamptz",
      notNull: false,
      comment: "Set when the recipient signed the acknowledgment message",
    },
    skipped_at: {
      type: "timestamptz",
      notNull: false,
      comment: "Set when the recipient dismissed the acknowledgment without signing",
    },
    signed_message: {
      type: "text",
      notNull: false,
      comment: "Freighter signMessage output retained as evidence of acceptance",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createIndex(
    "stream_acknowledgments",
    ["recipient", "sponsor", "token"],
    {
      name: "uq_stream_acknowledgments_stream",
      unique: true,
    },
  );

  pgm.createIndex("stream_acknowledgments", "recipient", {
    name: "idx_stream_acknowledgments_recipient",
  });

  pgm.sql(`
    CREATE OR REPLACE FUNCTION stream_acknowledgments_set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER trg_stream_acknowledgments_updated_at
    BEFORE UPDATE ON stream_acknowledgments
    FOR EACH ROW
    EXECUTE FUNCTION stream_acknowledgments_set_updated_at();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_stream_acknowledgments_updated_at
    ON stream_acknowledgments;
  `);
  pgm.sql(`
    DROP FUNCTION IF EXISTS stream_acknowledgments_set_updated_at();
  `);
  pgm.dropTable("stream_acknowledgments");
}
