use soroban_sdk::{Address, Env, Symbol, symbol_short};

/// Emitted when a new vesting stream is created.
///
/// Topics: `["vesting_created", recipient]`
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
    env.events().publish(
        (symbol_short!("vc_done"), recipient.clone()),
        token.clone(),
    );
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
