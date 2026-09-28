// `#[contracttype]` emits an inherent `impl Type { spec_xdr() }` with no doc
// comment of its own; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contracttype, symbol_short, Address, BytesN, Env, String, Symbol};

/// Data payload for the `StreamCreated` event.
///
/// Published as the event data field when a new vesting stream is created.
/// Off-chain indexers can decode this struct to reconstruct full stream state.
#[contracttype]
#[allow(missing_docs)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCreatedData {
    /// The SAC token being vested.
    pub token: Address,
    /// Tokens released per ledger (rate_per_ledger).
    pub rate: i128,
    /// Ledger sequence at which the stream starts.
    pub start_ledger: u32,
    /// Ledger sequence at which the cliff is reached.
    pub cliff_ledger: u32,
    /// Ledger sequence at which the stream ends.
    pub end_ledger: u32,
    /// Total tokens deposited (`rate × (end_ledger - start_ledger)`).
    pub total_deposit: i128,
}

/// Emitted when a new vesting stream is created.
///
/// Topics: `[Symbol("StreamCreated"), sponsor, recipient]`
/// Data:   `StreamCreatedData { token, rate, start_ledger, cliff_ledger, end_ledger, total_deposit }`
pub fn emit_stream_created(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    token: &Address,
    rate_per_ledger: i128,
    start_ledger: u32,
    cliff_ledger: u32,
    end_ledger: u32,
    total_deposit: i128,
) {
    let total_deposit = rate * (end_ledger - start_ledger) as i128;
    let data = StreamCreatedData {
        token: token.clone(),
        rate,
        start_ledger,
        cliff_ledger,
        end_ledger,
    };
    // Include metadata in topics for off-chain indexing.
    let _ = metadata; // stored in schedule; not emitted in topics to keep topic count ≤ 4
    env.events().publish(
        (
            Symbol::new(env, "StreamCreated"),
            sponsor.clone(),
            recipient.clone(),
        ),
        (data, metadata.clone()),
    );
}

/// Emitted when a variable-rate vesting stream is created.
///
/// Topics: `["vc_vrcreat", recipient]`
/// Data:   `(sponsor, token, start_ledger, cliff_ledger, end_ledger, total_deposited)`
pub fn emit_variable_stream_created(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    token: &Address,
    start_ledger: u32,
    cliff_ledger: u32,
    end_ledger: u32,
    total_deposited: i128,
) {
    env.events().publish(
        (symbol_short!("vc_vrcre"), recipient.clone()),
        (
            sponsor.clone(),
            token.clone(),
            start_ledger,
            cliff_ledger,
            end_ledger,
            total_deposited,
        ),
    );
}

/// Emitted when a new milestone vesting stream is created.
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

/// Emitted when a recipient successfully claims from a variable-rate stream.
///
/// Topics: `["vc_vrclam", recipient]`
/// Data:   `(amount, ledger_claimed_through)`
pub fn emit_variable_tokens_claimed(
    env: &Env,
    recipient: &Address,
    amount: i128,
    ledger_claimed_through: u32,
) {
    env.events().publish(
        (symbol_short!("vc_vrclam"), recipient.clone()),
        (amount, ledger_claimed_through),
    );
}

/// Emitted when a vesting schedule is fully exhausted and auto-cleaned up.
///
/// Topics: `["vc_done", recipient]`
/// Data:   `token`
pub fn emit_stream_completed(env: &Env, recipient: &Address, token: &Address) {
    env.events()
        .publish((symbol_short!("vc_done"), recipient.clone()), token.clone());
}

/// Emitted when a sponsor cancels a vesting stream.
///
/// Topics: `["vc_cancel", recipient]`
/// Data:   `(sponsor_refund)`
pub fn emit_stream_cancelled(env: &Env, recipient: &Address, refunded_amount: i128) {
    env.events().publish(
        (symbol_short!("vc_cancel"), recipient.clone()),
        refunded_amount,
    );
}

/// Emitted when a recipient's stream is transferred to a new address.
///
/// Topics: `["StreamTransferred", current_recipient]`
/// Data:   `(new_recipient)`
pub fn emit_stream_transferred(
    env: &Env,
    current_recipient: &Address,
    new_recipient: &Address,
) {
    env.events().publish(
        (
            Symbol::new(env, "StreamTransferred"),
            current_recipient.clone(),
        ),
        new_recipient.clone(),
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

/// Emitted when an expired stream is drained.
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

/// Emitted by the `emergency_drain` entry point.
///
/// Topics: `["ContractInit", admin]`
/// Data:   `(fee_bps, treasury)`
pub fn emit_contract_initialized(env: &Env, admin: &Address, fee_bps: u32, treasury: &Address) {
    env.events().publish(
        (Symbol::new(env, "ContractInit"), admin.clone()),
        (fee_bps, treasury.clone()),
    );
}

// ── Multi-token events ────────────────────────────────────────────────────────

/// Emitted when a new multi-token vesting stream is created.
///
/// Topics: `["vmt_create", recipient]`
/// Data:   `(sponsor, allocations, start_ledger, cliff_ledger, end_ledger)`
pub fn emit_multi_stream_created(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    allocations: &Vec<TokenAllocation>,
    start_ledger: u32,
    cliff_ledger: u32,
    end_ledger: u32,
) {
    env.events().publish(
        (symbol_short!("vmt_crt"), recipient.clone()),
        (
            sponsor.clone(),
            allocations.clone(),
            start_ledger,
            cliff_ledger,
            end_ledger,
        ),
    );
}

/// Emitted when a recipient claims all vested tokens from a multi-token stream.
///
/// Topics: `["vmt_claim", recipient]`
/// Data:   `(ledger_claimed_through)`
///
/// The per-token amounts are implicit from the stored allocations and can be
/// reconstructed off-chain from the ledger range.
pub fn emit_multi_tokens_claimed(
    env: &Env,
    recipient: &Address,
    ledger_claimed_through: u32,
) {
    env.events().publish(
        (symbol_short!("vmt_clm"), recipient.clone()),
        ledger_claimed_through,
    );
}

/// Emitted when a multi-token vesting stream is fully exhausted.
///
/// Topics: `["vmt_done", recipient]`
/// Data:   `()` — no additional payload; completion is self-explanatory.
pub fn emit_multi_stream_completed(env: &Env, recipient: &Address) {
    env.events().publish(
        (symbol_short!("vmt_don"), recipient.clone()),
        (),
    );
}

/// Emitted when a sponsor cancels a multi-token vesting stream.
///
/// Topics: `["vmt_cancel", recipient]`
/// Data:   `(sponsor)`
pub fn emit_multi_stream_cancelled(env: &Env, recipient: &Address, sponsor: &Address) {
    env.events().publish(
        (symbol_short!("vmt_cnl"), recipient.clone()),
        sponsor.clone(),
    );
}
