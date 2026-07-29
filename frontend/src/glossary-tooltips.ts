/**
 * Glossary tooltip definitions.
 * Single source of truth — all definitions sourced from docs/glossary.md.
 * Used by the Tooltip / GlossaryTooltip components throughout the UI.
 */

export interface GlossaryEntry {
  term: string;
  definition: string;
  example?: string;
}

export const GLOSSARY = {
  cliff: {
    term: "Cliff",
    definition:
      "A mandatory waiting period before any tokens can be claimed. No tokens are claimable before the cliff ledger, even though accrual begins immediately at stream start.",
    example: "e.g. a 30-day cliff ≈ 518,400 ledgers (30 × 17,280 ledgers/day)",
  },
  cliff_duration: {
    term: "Cliff duration",
    definition:
      "The number of ledgers from stream start until the cliff is reached. Must be strictly less than the total duration.",
    example: "e.g. 1 day = 17,280 ledgers at ~5 s/ledger",
  },
  ledger: {
    term: "Ledger",
    definition:
      "The fundamental unit of time on the Stellar network. A new ledger closes approximately every 5 seconds. All durations in this contract are expressed in ledgers, not wall-clock time.",
    example: "e.g. 1 day ≈ 17,280 ledgers  |  1 hour ≈ 720 ledgers",
  },
  rate: {
    term: "Rate",
    definition:
      "The number of tokens that accrue per ledger. Must be a positive integer (> 0). Multiply by total duration to get the total deposit required.",
    example: "e.g. rate=10 over 100 ledgers = 1,000 tokens total deposit",
  },
  sac: {
    term: "SAC (Stellar Asset Contract)",
    definition:
      "A Soroban smart contract that wraps a classic Stellar asset and exposes it via the standard token interface. The token address must be a SAC contract address starting with C…",
    example: "e.g. token address starts with C… (56 characters total)",
  },
  sponsor: {
    term: "Sponsor",
    definition:
      "The Stellar address that creates a vesting stream and deposits the full token allocation upfront. Only the original sponsor can cancel a stream.",
    example: "e.g. your wallet address (G… 56 characters)",
  },
  recipient: {
    term: "Recipient",
    definition:
      "The beneficiary Stellar address of a vesting stream. The recipient can call claim to withdraw accrued tokens after the cliff.",
    example: "e.g. contributor's Stellar address (G… 56 characters)",
  },
  deposit: {
    term: "Deposit",
    definition:
      "The total token amount locked into the contract vault at stream creation, computed as rate × total_duration. The sponsor must hold this balance when creating the stream.",
    example: "e.g. rate=10 × 17,280 ledgers = 172,800 tokens deposited",
  },
  total_duration: {
    term: "Total duration",
    definition:
      "The total length of the vesting stream in ledgers. Must be strictly greater than the cliff duration. Determines the end ledger and total deposit required.",
    example: "e.g. 10 days = 172,800 ledgers",
  },
  catch_up_claim: {
    term: "Catch-up claim",
    definition:
      "The lump-sum transfer made at the first claim after the cliff. All tokens accrued since stream start are released in a single transaction the moment the cliff is passed.",
    example: "e.g. if cliff = 30 days, all 30 days of accrued tokens transfer instantly on first claim",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
