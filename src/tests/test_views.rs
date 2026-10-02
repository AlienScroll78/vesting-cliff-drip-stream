#![cfg(test)]

use crate::{
    tests::{
        advance_ledger, setup_env,
        factory::{at_cliff_stream, fully_claimed_stream, post_cliff_stream, pre_cliff_stream},
    },
};

/// `claimable_amount` returns 0 before the cliff.
#[test]
fn test_claimable_amount_before_cliff_is_zero() {
    let env = setup_env();
    let (stream, addrs) = pre_cliff_stream(&env);

    assert_eq!(stream.client.claimable_amount(&addrs.recipient), 0);
}

/// `claimable_amount` reflects accrual correctly after the cliff.
#[test]
fn test_claimable_amount_after_cliff() {
    let env = setup_env();
    // post_cliff_stream(25) → ledger 175 (75 ledgers past start × 10 = 750).
    let (stream, addrs) = post_cliff_stream(&env, 25);

    assert_eq!(stream.client.claimable_amount(&addrs.recipient), 750);
}

/// `is_cliff_passed` transitions from false to true as the ledger advances.
#[test]
fn test_is_cliff_passed() {
    let env = setup_env();
    // pre_cliff_stream lands at ledger 120 – cliff not passed.
    let (stream, addrs) = pre_cliff_stream(&env);
    assert!(!stream.client.is_cliff_passed(&addrs.recipient));

    // Advance to exactly the cliff (30 more ledgers to reach 150).
    advance_ledger(&env, 30);
    assert!(stream.client.is_cliff_passed(&addrs.recipient));
}

/// `get_schedule` returns `None` once the stream has been fully claimed.
#[test]
fn test_get_schedule_returns_none_after_completion() {
    let env = setup_env();
    let (stream, addrs) = fully_claimed_stream(&env);

    assert!(stream.client.get_schedule(&addrs.recipient).is_none());
}

/// `claimable_amount` returns the full deposit when the stream has expired.
#[test]
fn test_claimable_amount_at_cliff_equals_accrued_since_start() {
    let env = setup_env();
    let (stream, addrs) = at_cliff_stream(&env);

    // 50 ledgers × 10 = 500
    assert_eq!(stream.client.claimable_amount(&addrs.recipient), 500);
}

#[test]
fn test_get_status_pre_cliff() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    assert_eq!(client.get_status(&recipient), Some(StreamStatus::PreCliff));
}

#[test]
fn test_get_status_active() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 100);
    assert_eq!(client.get_status(&recipient), Some(StreamStatus::Active));
}

#[test]
fn test_get_status_expired() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, recipient) = generate_addresses(&env);
    create_vesting_stream(&env, &client, &sponsor, &recipient, 10, 50, 200);

    advance_ledger(&env, 200);
    assert_eq!(client.get_status(&recipient), Some(StreamStatus::Expired));
}

#[test]
fn test_get_status_none_when_no_schedule() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let recipient = Address::generate(&env);

    assert_eq!(client.get_status(&recipient), None);
}

#[test]
fn test_claimable_amount_nonexistent_returns_zero() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let random = Address::generate(&env);

    assert_eq!(client.claimable_amount(&random), 0);
}

#[test]
fn test_get_claimable_batch_preserves_order_and_returns_zero_for_unknown() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let (sponsor, first_recipient) = generate_addresses(&env);
    let second_recipient = Address::generate(&env);
    let unknown_recipient = Address::generate(&env);

    create_vesting_stream(&env, &client, &sponsor, &first_recipient, 10, 50, 200);
    create_vesting_stream(&env, &client, &sponsor, &second_recipient, 20, 50, 200);
    advance_ledger(&env, 75);

    let recipients = Vec::from_array(
        &env,
        [unknown_recipient.clone(), first_recipient.clone(), second_recipient.clone()],
    );
    let claimable = client.get_claimable_batch(&recipients).unwrap();

    assert_eq!(
        claimable,
        Vec::from_array(
            &env,
            [
                (unknown_recipient, 0),
                (first_recipient, 750),
                (second_recipient, 1_500),
            ],
        )
    );
}

#[test]
fn test_get_claimable_batch_rejects_more_than_twenty_recipients() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let mut recipients = Vec::new(&env);
    for _ in 0..21 {
        recipients.push_back(Address::generate(&env));
    }

    let err = client
        .try_get_claimable_batch(&recipients)
        .unwrap_err()
        .unwrap_err();

    assert_eq!(err, VestingError::BatchTooLarge);
}

#[test]
fn test_is_cliff_passed_nonexistent_returns_false() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);
    let random = Address::generate(&env);

    assert!(!client.is_cliff_passed(&random));
}
