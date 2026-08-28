use soroban_sdk::{contracttype, symbol_short, Address, BytesN, Env, String, Symbol, Vec};

/// Data payload emitted when a new vesting stream is created.
///
/// Exported from `lib.rs` for use by off-chain indexers.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCreatedData {
    /// The token being streamed.
    pub token: Address,
    /// Tokens released per ledger.
    pub rate: i128,
    /// Stream start ledger.
    pub start_ledger: u32,
    /// Cliff ledger.
    pub cliff_ledger: u32,
    /// End ledger.
    pub end_ledger: u32,
    /// Total tokens deposited.
    pub total_deposit: i128,
}

/// Emitted when a new vesting stream is created.
///
/// Topics: `["StreamCreated", sponsor, recipient]`
/// Data:   `StreamCreatedData`
pub fn emit_stream_created(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    token: &Address,
    rate: i128,
    start_ledger: u32,
    cliff_ledger: u32,
    end_ledger: u32,
    metadata: &Option<String>,
) {
    let total_deposit = rate * (end_ledger - start_ledger) as i128;
    let data = StreamCreatedData {
        token: token.clone(),
        rate,
        start_ledger,
        cliff_ledger,
        end_ledger,
        total_deposit,
    };
    let _ = metadata; // stored on-chain in schedule; not re-emitted to save budget
    env.events().publish(
        (Symbol::new(env, "StreamCreated"), sponsor.clone(), recipient.clone()),
        data,
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
        (symbol_short!("vc_vrcreat"), recipient.clone()),
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

/// Emitted when a recipient claims milestone tokens.
///
/// Topics: `["vc_ms_clm", recipient]`
/// Data:   `(amount)`
pub fn emit_milestone_claimed(env: &Env, recipient: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("vc_ms_clm"), recipient.clone()),
        amount,
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

/// Emitted when the token allowlist is updated (token added or removed).
///
/// Topics: `["AllowlistUpdated", admin]`
/// Data:   `(token, added)` — `added` is `true` for add, `false` for remove
pub fn emit_allowlist_updated(env: &Env, admin: &Address, token: &Address, added: bool) {
    env.events().publish(
        (Symbol::new(env, "AllowlistUpdated"), admin.clone()),
        (token.clone(), added),
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

/// Emitted when the contract is upgraded to a new WASM hash.
///
/// Topics: `["ContractUpgraded", admin]`
/// Data:   `new_wasm_hash`
pub fn emit_contract_upgraded(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    env.events().publish(
        (Symbol::new(env, "ContractUpgraded"), admin.clone()),
        new_wasm_hash.clone(),
    );
}

/// Emitted when a protocol fee is collected at stream creation.
///
/// Topics: `["FeeCollected", sponsor]`
/// Data:   `(treasury, fee_amount)`
pub fn emit_fee_collected(env: &Env, sponsor: &Address, treasury: &Address, fee_amount: i128) {
    env.events().publish(
        (Symbol::new(env, "FeeCollected"), sponsor.clone()),
        (treasury.clone(), fee_amount),
    );
}

/// Emitted when a stream is paused.
///
/// Topics: `["StreamPaused", recipient]`
/// Data:   `(sponsor, paused_at_ledger)`
pub fn emit_stream_paused(
    env: &Env,
    recipient: &Address,
    sponsor: &Address,
    paused_at_ledger: u32,
) {
    env.events().publish(
        (Symbol::new(env, "StreamPaused"), recipient.clone()),
        (sponsor.clone(), paused_at_ledger),
    );
}

/// Emitted when a paused stream is resumed.
///
/// Topics: `["StreamResumed", recipient]`
/// Data:   `(sponsor, new_end_ledger)`
pub fn emit_stream_resumed(
    env: &Env,
    recipient: &Address,
    sponsor: &Address,
    new_end_ledger: u32,
) {
    env.events().publish(
        (Symbol::new(env, "StreamResumed"), recipient.clone()),
        (sponsor.clone(), new_end_ledger),
    );
}

/// Emitted when a recipient is transferred to a new address.
///
/// Topics: `["RecipientTransferred", old_recipient]`
/// Data:   `new_recipient`
pub fn emit_recipient_transferred(
    env: &Env,
    old_recipient: &Address,
    new_recipient: &Address,
) {
    env.events().publish(
        (Symbol::new(env, "RecipientTransferred"), old_recipient.clone()),
        new_recipient.clone(),
    );
}

/// Emitted when the minimum deposit threshold is updated.
///
/// Topics: `["MinDepositSet", admin]`
/// Data:   `min_deposit`
pub fn emit_min_deposit_set(env: &Env, admin: &Address, min_deposit: i128) {
    env.events().publish(
        (Symbol::new(env, "MinDepositSet"), admin.clone()),
        min_deposit,
    );
}
