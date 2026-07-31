use soroban_sdk::{symbol_short, Address, Env, String, Symbol};

/// Emitted when a new vesting stream is created.
///
/// Topics: `["vc_create", recipient]`
/// Data:   `(sponsor, token, rate_per_ledger, start_ledger, cliff_ledger, end_ledger)`
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
            token.clone(),
            rate_per_ledger,
            start_ledger,
            cliff_ledger,
            end_ledger,
            metadata.clone(),
        ),
        data,
    );
}

/// Emitted when a variable-rate vesting stream is created.
///
/// Topics: `["vc_vrcreate", recipient]`
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
        data,
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
        data,
    );
}

/// Emitted when a recipient successfully claims vested tokens.
///
/// Topics: `["vc_claim", recipient]`
/// Data:   `(amount, ledger_claimed_through, dust_collected)`
///
/// `dust_collected` is the sub-1-token remainder captured at `end_ledger` to
/// ensure no tokens are permanently stranded in the contract vault.
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
/// Topics: `["vc_vrclaim", recipient]`
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
        (
            sponsor.clone(),
            refunded_to_sponsor,
            released_to_recipient,
        ),
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
