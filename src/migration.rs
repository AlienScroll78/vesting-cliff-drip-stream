//! # VestingSchedule Schema Migration Framework
//!
//! ## Problem
//! Soroban XDR deserialization is forward-compatible at the encoding level:
//! new trailing fields default to the zero-value when absent in old stored
//! bytes.  However, a zero-value `schema_version` would be ambiguous without
//! explicit handling.  This module centralises the detection and upgrade logic
//! so every read path gets consistent behaviour.
//!
//! ## How It Works
//! 1. `storage::get_schedule` calls `migrate_schedule` after deserialising.
//! 2. `migrate_schedule` checks `schedule.schema_version`:
//!    - `0` → record was written before V2 (no `schema_version` field).
//!      Apply V1 → V2 defaults and write back.
//!    - `1` → legacy explicit V1. Apply V1 → V2 defaults and write back.
//!    - `CURRENT_SCHEMA_VERSION` → already current; no-op.
//! 3. Each version step fills in documented defaults for new fields.
//!
//! ## Adding a V3 Field
//! 1. Add the field to `VestingSchedule` with a sensible default.
//! 2. Bump `CURRENT_SCHEMA_VERSION` to `3`.
//! 3. Add a `migrate_v2_to_v3` function.
//! 4. Call it from `migrate_schedule` when `schema_version == 2`.
//!
//! ## Field Defaults by Version
//! | Version | New Field       | Default                          |
//! |---------|-----------------|----------------------------------|
//! | V2      | `schema_version`| `CURRENT_SCHEMA_VERSION` (= 2)  |

use soroban_sdk::Env;

use crate::{
    storage,
    types::{VestingSchedule, CURRENT_SCHEMA_VERSION},
};

// ── Public entry point ────────────────────────────────────────────────────────

/// Ensures `schedule` is at the current schema version.
///
/// If the schedule is already current this is a zero-cost no-op. If it needs
/// upgrading the function mutates `schedule` in-place, persists the updated
/// record via [`storage::set_schedule`], and returns `true` so the caller can
/// log or emit telemetry.
///
/// # Arguments
/// * `env`       – Soroban environment (needed for storage writes).
/// * `recipient` – Storage key for the schedule.
/// * `schedule`  – The schedule to inspect and possibly upgrade.
///
/// # Returns
/// `true` if a migration was applied and the record was re-persisted,
/// `false` if the record was already at the current version.
pub fn migrate_schedule(
    env: &Env,
    recipient: &soroban_sdk::Address,
    schedule: &mut VestingSchedule,
) -> bool {
    // `schema_version == 0` means the record pre-dates the `schema_version`
    // field (V1).  We treat it identically to an explicit `schema_version == 1`.
    let stored_version = if schedule.schema_version == 0 {
        1
    } else {
        schedule.schema_version
    };

    if stored_version >= CURRENT_SCHEMA_VERSION {
        return false; // already current — fast path
    }

    // Run through each step sequentially so a multi-version gap is handled
    // correctly (e.g., V1 → V2 → V3 without skipping V2 → V3 logic).
    let mut current = stored_version;

    if current < 2 {
        migrate_v1_to_v2(schedule);
        current = 2;
    }

    // Future: if current < 3 { migrate_v2_to_v3(schedule); current = 3; }
    let _ = current; // suppress unused-variable warning

    // Persist the upgraded record so subsequent reads skip this path.
    storage::set_schedule(env, recipient, schedule);
    true
}

// ── Version step functions ────────────────────────────────────────────────────

/// Upgrades a V1 schedule to V2.
///
/// V2 adds `schema_version`.  Since the field was absent in V1 storage it
/// deserialises as `0`; this function stamps it with the current version so
/// the record is recognised as current on the next read.
///
/// # Documented V1 → V2 defaults
/// | Field            | V1 value (implied) | V2 default                  |
/// |------------------|--------------------|------------------------------|
/// | `schema_version` | `0` (absent)       | `CURRENT_SCHEMA_VERSION` (2) |
fn migrate_v1_to_v2(schedule: &mut VestingSchedule) {
    schedule.schema_version = CURRENT_SCHEMA_VERSION;
}
