use soroban_sdk::{symbol_short, Address, Env, String};

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

/// Emitted when a sponsor claws back a stream for compliance reasons.
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

/// Emitted when an expired stream is drained by cleanup caller.
///
/// Topics: `["vc_edrain", recipient]`
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
        (symbol_short!("vc_edrain"), recipient.clone()),
        (caller.clone(), sponsor.clone(), token.clone(), amount),
    );
}

/// Emitted when a stream is paused by the sponsor.
///
/// Topics: `["vc_pause", recipient]`
/// Data:   `(sponsor, paused_at_ledger)`
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

/// Emitted when a stream is resumed by the sponsor.
///
/// Topics: `["vc_resume", recipient]`
/// Data:   `(sponsor, new_end_ledger)`
pub fn emit_stream_resumed(
    env: &Env,
    recipient: &Address,
    sponsor: &Address,
    new_end_ledger: u32,
) {
    env.events().publish(
        (symbol_short!("vc_resume"), recipient.clone()),
        (sponsor.clone(), new_end_ledger),
    );
}

/// Emitted when a recipient transfers their stream to a new address.
///
/// Topics: `["vc_trans", current_recipient]`
/// Data:   `(old_recipient, new_recipient)`
pub fn emit_recipient_transferred(
    env: &Env,
    current_recipient: &Address,
    new_recipient: &Address,
) {
    env.events().publish(
        (symbol_short!("vc_trans"), current_recipient.clone()),
        (current_recipient.clone(), new_recipient.clone()),
    );
}
