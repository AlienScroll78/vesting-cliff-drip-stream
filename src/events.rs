// `#[contracttype]` emits an inherent `impl Type { spec_xdr() }` with no doc
// comment of its own; rustc doesn't propagate item-level `#[allow]` onto
// attribute-macro-generated sibling impls, so the allow has to be module-scoped.
#![allow(missing_docs)]

use soroban_sdk::{contracttype, symbol_short, Address, BytesN, Env, String, Symbol, Vec};

use crate::types::TokenAllocation;

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
/// Data:   `(StreamCreatedData, metadata_hash)`
pub fn emit_stream_created(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    token: &Address,
    rate_per_ledger: i128,
    start_ledger: u32,
    cliff_ledger: u32,
    end_ledger: u32,
    metadata: &Option<String>,
) {
    let total_deposit = (end_ledger - start_ledger) as i128 * rate_per_ledger;
    let data = StreamCreatedData {
        token: token.clone(),
        rate: rate_per_ledger,
        start_ledger,
        cliff_ledger,
        end_ledger,
        total_deposit,
    };
    // metadata is stored in the schedule; we pass it alongside data for indexers
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
/// Topics: `["vc_vrcre", recipient]`
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
/// Topics: `["StreamCancelled", recipient]`
/// Data:   `(sponsor, refund_to_sponsor, released_to_recipient, ledger)`
pub fn emit_stream_cancelled(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    refund_to_sponsor: i128,
    released_to_recipient: i128,
) {
    let ledger = env.ledger().sequence();
    env.events().publish(
        (
            Symbol::new(env, "StreamCancelled"),
            recipient.clone(),
        ),
        (
            sponsor.clone(),
            refund_to_sponsor,
            released_to_recipient,
            ledger,
        ),
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

/// Emitted when a recipient's stream is transferred to a new address.
pub fn emit_recipient_transferred(
    env: &Env,
    current_recipient: &Address,
    new_recipient: &Address,
) {
    emit_stream_transferred(env, current_recipient, new_recipient);
}

/// Emitted when a stream is paused.
pub fn emit_stream_paused(
    env: &Env,
    recipient: &Address,
    sponsor: &Address,
    paused_at_ledger: u32,
) {
    env.events().publish(
        (symbol_short!("vc_pause"), recipient.clone()),
        (sponsor.clone(), paused_at_ledger),
    );
}

/// Emitted when a paused stream is resumed.
pub fn emit_stream_resumed(
    env: &Env,
    recipient: &Address,
    sponsor: &Address,
    new_end_ledger: u32,
) {
    env.events().publish(
        (symbol_short!("vc_resum"), recipient.clone()),
        (sponsor.clone(), new_end_ledger),
    );
}

/// Emitted when a milestone is claimed.
pub fn emit_milestone_claimed(env: &Env, recipient: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("vc_ms_cl"), recipient.clone()),
        amount,
    );
}

/// Emitted when the allowlist is updated.
pub fn emit_allowlist_updated(env: &Env, admin: &Address, token: &Address, added: bool) {
    env.events().publish(
        (Symbol::new(env, "AllowlistUpdated"), admin.clone()),
        (token.clone(), added),
    );
}

/// Emitted when the contract is upgraded.
pub fn emit_contract_upgraded(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (Symbol::new(env, "ContractUpgraded"), admin.clone()),
        new_wasm_hash.clone(),
    );
}

/// Emitted when a protocol fee is collected.
pub fn emit_fee_collected(env: &Env, sponsor: &Address, treasury: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "FeeCollected"), sponsor.clone()),
        (treasury.clone(), amount),
    );
}

/// Emitted when an emergency drain occurs.
pub fn emit_emergency_drain(
    env: &Env,
    recipient: &Address,
    sponsor: &Address,
    amount: i128,
) {
    env.events().publish(
        (symbol_short!("vc_emdrn"), recipient.clone()),
        (sponsor.clone(), amount),
    );
}

/// Data payload for the `StreamClawedBack` event.
///
/// Published as the event data field when a compliance clawback is performed.
/// All six fields are required by regulatory audit trails and off-chain indexers.
#[contracttype]
#[allow(missing_docs)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamClawedBackData {
    /// The original sponsor who funded the stream (receives recovered tokens).
    pub sponsor: Address,
    /// The recipient whose stream was clawed back.
    pub recipient: Address,
    /// SAC token contract address.
    pub token: Address,
    /// Total tokens recovered by the sponsor.
    pub amount_recovered: i128,
    /// SHA-256 hash of the compliance reason string, for machine-readable indexing.
    pub reason_hash: BytesN<32>,
    /// Ledger sequence at which the clawback was executed.
    pub ledger: u32,
}

/// Emitted when a sponsor performs a compliance clawback on a stream.
///
/// Topics: `["vc_claw", recipient]`
/// Data:   `StreamClawedBackData` — includes sponsor, recipient, token,
///          amount_recovered, reason_hash (SHA-256 of reason), ledger, and reason string.
pub fn emit_stream_clawed_back(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
    reason: &String,
) {
    let ledger = env.ledger().sequence();

    // Compute SHA-256 of the reason string for machine-readable compliance indexing.
    let reason_bytes = reason.to_xdr(env);
    let reason_hash = env.crypto().sha256(&reason_bytes);

    let data = StreamClawedBackData {
        sponsor: sponsor.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        amount_recovered: amount,
        reason_hash,
        ledger,
    };

    env.events().publish(
        (symbol_short!("vc_claw"), recipient.clone()),
        (data, reason.clone()),
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

/// Emitted when the contract is initialized.
///
/// Topics: `["vc_emgdr", recipient]`
/// Data:   `(sponsor, amount)`
pub fn emit_emergency_drain(env: &Env, recipient: &Address, sponsor: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("vc_emgdr"), recipient.clone()),
        (sponsor.clone(), amount),
    );
}

/// Emitted when the contract is initialized.
///
/// Topics: `["ContractInit", admin]`
/// Data:   `(fee_bps, treasury)`
pub fn emit_contract_initialized(env: &Env, admin: &Address, fee_bps: u32, treasury: &Address) {
    env.events().publish(
        (Symbol::new(env, "ContractInit"), admin.clone()),
        (fee_bps, treasury.clone()),
    );
}

/// Emitted when the contract is upgraded to a new WASM.
///
/// Topics: `["ContractUpgraded", admin]`
/// Data:   `(new_wasm_hash)`
pub fn emit_contract_upgraded(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (Symbol::new(env, "ContractUpgraded"), admin.clone()),
        new_wasm_hash.clone(),
    );
}

/// Emitted when the token allowlist is updated (token added or removed).
///
/// Topics: `["AllowlistUpdated", admin]`
/// Data:   `(token, added)`
pub fn emit_allowlist_updated(env: &Env, admin: &Address, token: &Address, added: bool) {
    env.events().publish(
        (Symbol::new(env, "AllowlistUpdated"), admin.clone()),
        (token.clone(), added),
    );
}

/// Emitted when the recipient allowlist is updated.
///
/// Topics: `["RecipientAllowlist", admin]`
/// Data:   `(recipient, allowed)`
pub fn emit_recipient_allowlist_updated(
    env: &Env,
    admin: &Address,
    recipient: &Address,
    allowed: bool,
) {
    env.events().publish(
        (Symbol::new(env, "RecipientAllowlist"), admin.clone()),
        (recipient.clone(), allowed),
    );
}

/// Emitted when a stream is paused by its sponsor.
///
/// Topics: `["StreamPaused", recipient]`
/// Data:   `(sponsor, paused_at_ledger)`
pub fn emit_stream_paused(env: &Env, recipient: &Address, sponsor: &Address, paused_at: u32) {
    env.events().publish(
        (Symbol::new(env, "StreamPaused"), recipient.clone()),
        (sponsor.clone(), paused_at),
    );
}

/// Emitted when a paused stream is resumed by its sponsor.
///
/// Topics: `["StreamResumed", recipient]`
/// Data:   `(sponsor, new_end_ledger)`
pub fn emit_stream_resumed(env: &Env, recipient: &Address, sponsor: &Address, new_end_ledger: u32) {
    env.events().publish(
        (Symbol::new(env, "StreamResumed"), recipient.clone()),
        (sponsor.clone(), new_end_ledger),
    );
}

/// Emitted when a batch of streams is created.
///
/// Topics: `["BatchStreamCreated", sponsor]`
/// Data:   `(count, total_deposit)`
pub fn emit_batch_stream_created(
    env: &Env,
    sponsor: &Address,
    count: u32,
    total_deposit: i128,
) {
    env.events().publish(
        (Symbol::new(env, "BatchStreamCreated"), sponsor.clone()),
        (count, total_deposit),
    );
}

/// Emitted when a protocol fee is collected.
///
/// Topics: `["FeeCollected", sponsor]`
/// Data:   `(treasury, amount)`
pub fn emit_fee_collected(env: &Env, sponsor: &Address, treasury: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "FeeCollected"), sponsor.clone()),
        (treasury.clone(), amount),
    );
}

/// Emitted when a milestone is claimed.
///
/// Topics: `["MilestoneClaimed", recipient]`
/// Data:   `(amount)`
pub fn emit_milestone_claimed(env: &Env, recipient: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "MilestoneClaimed"), recipient.clone()),
        amount,
    );
}

// ── Multi-token events ────────────────────────────────────────────────────────

/// Emitted when a new multi-token vesting stream is created.
///
/// Topics: `["vmt_crt", recipient]`
/// Data:   `(sponsor, allocations, start_ledger, cliff_ledger, end_ledger)`
#[allow(dead_code)]
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
/// Topics: `["vmt_clm", recipient]`
/// Data:   `(ledger_claimed_through)`
///
/// The per-token amounts are implicit from the stored allocations and can be
/// reconstructed off-chain from the ledger range.
#[allow(dead_code)]
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
#[allow(dead_code)]
pub fn emit_multi_stream_completed(env: &Env, recipient: &Address) {
    env.events()
        .publish((symbol_short!("vmt_don"), recipient.clone()), ());
}

/// Emitted when a sponsor cancels a multi-token vesting stream.
///
/// Topics: `["vmt_cnl", recipient]`
/// Data:   `(sponsor)`
#[allow(dead_code)]
pub fn emit_multi_stream_cancelled(env: &Env, recipient: &Address, sponsor: &Address) {
    env.events().publish(
        (symbol_short!("vmt_cnl"), recipient.clone()),
        sponsor.clone(),
    );
}
