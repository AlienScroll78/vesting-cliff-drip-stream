use soroban_sdk::{symbol_short, Address, BytesN, Env, String};

/// Emitted when a new vesting stream is created.
///
/// Topics: `["vc_create", recipient]`
/// Data:   `(sponsor, token, rate_per_ledger, start_ledger, cliff_ledger, end_ledger)`
pub fn emit_stream_created(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    token: &Address,
    rate_per_ledger: i128,
    start_ledger: u32,
    cliff_ledger: u32,
    end_ledger: u32,
) {
    env.events().publish(
        (symbol_short!("vc_create"), recipient.clone()),
        (
            sponsor.clone(),
            token.clone(),
            rate_per_ledger,
            start_ledger,
            cliff_ledger,
            end_ledger,
        ),
    );
}

/// Emitted when a new milestone vesting stream is created.
///
/// Topics: `["vc_ms_cr", recipient]`
/// Data:   `(sponsor, token, total_deposited, end_ledger)`
pub fn emit_milestone_stream_created(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    token: &Address,
    total_deposited: i128,
    end_ledger: u32,
) {
    env.events().publish(
        (symbol_short!("vc_ms_cr"), recipient.clone()),
        (
            sponsor.clone(),
            token.clone(),
            total_deposited,
            end_ledger,
        ),
    );
}

/// Emitted when a recipient successfully claims vested tokens.
///
/// Topics: `["vc_claim", recipient]`
/// Data:   `(amount, ledger_claimed_through)`
pub fn emit_tokens_claimed(
    env: &Env,
    recipient: &Address,
    amount: i128,
    ledger_claimed_through: u32,
) {
    env.events().publish(
        (symbol_short!("vc_claim"), recipient.clone()),
        (amount, ledger_claimed_through),
    );
}

/// Emitted when a milestone is reached during a claim on a milestone stream.
///
/// Topics: `["vc_ms_hit", recipient]`
/// Data:   `(milestone_index, ledger, bps_unlock, tokens_unlocked)`
pub fn emit_milestone_reached(
    env: &Env,
    recipient: &Address,
    milestone_index: u32,
    ledger: u32,
    bps_unlock: u32,
    tokens_unlocked: i128,
) {
    env.events().publish(
        (symbol_short!("vc_ms_hit"), recipient.clone()),
        (milestone_index, ledger, bps_unlock, tokens_unlocked),
    );
}

/// Emitted when a vesting schedule is fully exhausted.
///
/// Topics: `["vc_done", recipient]`
/// Data:   `(token)`
pub fn emit_stream_completed(env: &Env, recipient: &Address, token: &Address) {
    env.events()
        .publish((symbol_short!("vc_done"), recipient.clone()), token.clone());
}

/// Emitted when a sponsor cancels a vesting stream before it completes.
///
/// Topics: `["vc_cancel", recipient]`
/// Data:   `(refunded_amount)`
pub fn emit_stream_cancelled(env: &Env, recipient: &Address, refunded_amount: i128) {
    env.events().publish(
        (symbol_short!("vc_cancel"), recipient.clone()),
        refunded_amount,
    );
}

/// Emitted when a sponsor performs a compliance clawback on a stream.
///
/// Topics: `["vc_claw", recipient]`
/// Data:   `(sponsor, token, amount, reason)`
pub fn emit_stream_clawed_back(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
    reason: &String,
) {
    env.events().publish(
        (symbol_short!("vc_claw"), recipient.clone()),
        (sponsor.clone(), token.clone(), amount, reason.clone()),
    );
}

/// Emitted when an expired stream is drained by a permissionless caller.
///
/// Topics: `["vc_drain", recipient]`
/// Data:   `(caller, sponsor, token, amount)`
pub fn emit_stream_drained(
    env: &Env,
    caller: &Address,
    recipient: &Address,
    sponsor: &Address,
    token: &Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("vc_drain"), recipient.clone()),
        (caller.clone(), sponsor.clone(), token.clone(), amount),
    );
}

/// Emitted by the legacy `emergency_drain` entry point.
///
/// Topics: `["vc_drain", recipient]`
/// Data:   `(sponsor, amount)`
pub fn emit_emergency_drain(env: &Env, recipient: &Address, sponsor: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("vc_drain"), recipient.clone()),
        (sponsor.clone(), amount),
    );
}

/// Emitted when the contract WASM is upgraded by the admin.
///
/// Topics: `["vc_upg"]`
/// Data:   `(admin, old_wasm_hash, new_wasm_hash)`
pub fn emit_contract_upgraded(
    env: &Env,
    admin: &Address,
    new_wasm_hash: &BytesN<32>,
) {
    env.events().publish(
        (symbol_short!("vc_upg"),),
        (admin.clone(), new_wasm_hash.clone()),
    );
}
