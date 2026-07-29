use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol};

/// Data payload for the `StreamCreated` event.
///
/// Encoded as a single `contracttype` struct so off-chain indexers can
/// reconstruct the complete stream state from the event alone without
/// needing any storage reads.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(missing_docs)]
pub struct StreamCreatedData {
    /// The SAC token contract being streamed.
    pub token: Address,
    /// Tokens released per ledger.
    pub rate: i128,
    /// Ledger sequence at which the stream was created.
    pub start_ledger: u32,
    /// Ledger sequence at which the cliff is reached.
    pub cliff_ledger: u32,
    /// Ledger sequence at which the stream ends.
    pub end_ledger: u32,
    /// Full deposit transferred from sponsor at creation (`rate × total_duration`).
    pub total_deposit: i128,
}

/// Emitted when a new vesting stream is created.
///
/// Topics: `["StreamCreated", sponsor, recipient]`
/// Data:   `StreamCreatedData { token, rate, start_ledger, cliff_ledger, end_ledger, total_deposit }`
///
/// Three topics allow efficient indexer filtering by event type, sponsor, or
/// recipient independently. The data struct carries every field needed for
/// full stream reconstruction from events alone.
pub fn emit_stream_created(
    env: &Env,
    sponsor: &Address,
    recipient: &Address,
    token: &Address,
    rate: i128,
    start_ledger: u32,
    cliff_ledger: u32,
    end_ledger: u32,
    total_deposit: i128,
) {
    let data = StreamCreatedData {
        token: token.clone(),
        rate,
        start_ledger,
        cliff_ledger,
        end_ledger,
        total_deposit,
    };
    env.events().publish(
        (
            Symbol::new(env, "StreamCreated"),
            sponsor.clone(),
            recipient.clone(),
        ),
        data,
    );
}

/// Emitted when a recipient successfully claims vested tokens.
///
/// Topics: `["vesting_claim", recipient]`
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

/// Emitted when a vesting schedule is fully exhausted.
///
/// Topics: `["vesting_done", recipient]`
/// Data:   `(token)`
pub fn emit_stream_completed(env: &Env, recipient: &Address, token: &Address) {
    env.events()
        .publish((symbol_short!("vc_done"), recipient.clone()), token.clone());
}

/// Emitted when a sponsor cancels a vesting stream before it completes.
///
/// Topics: `["vesting_cancel", recipient]`
/// Data:   `(refunded_amount)`
pub fn emit_stream_cancelled(env: &Env, recipient: &Address, refunded_amount: i128) {
    env.events().publish(
        (symbol_short!("vc_cancel"), recipient.clone()),
        refunded_amount,
    );
}

/// Emitted when a sponsor recovers stuck tokens via the emergency drain.
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
