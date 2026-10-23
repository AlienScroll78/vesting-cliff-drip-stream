#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, String};

use crate::{
    error::VestingError,
    tests::{generate_addresses, register_contract, setup_env, setup_token},
};

/// get_config returns compile-time defaults when nothing has been set.
#[test]
fn test_get_config_returns_defaults() {
    let env = setup_env();
    let (_contract_id, client) = register_contract(&env);

    let max_cliff = client.get_config(&String::from_str(&env, "max_cliff_ratio"));
    assert_eq!(max_cliff, 5_000);

    let min_rate = client.get_config(&String::from_str(&env, "min_rate"));
    assert_eq!(min_rate, 1);
}

/// Admin can override max_cliff_ratio and the new value is returned.
#[test]
fn test_set_config_max_cliff_ratio() {
    let env = setup_env();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    use crate::contract::{VestingDrips, VestingDripsClient};
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    client.initialize(&admin, &0u32, &treasury);

    client.set_config(&admin, &String::from_str(&env, "max_cliff_ratio"), &3_000i128);

    let val = client.get_config(&String::from_str(&env, "max_cliff_ratio"));
    assert_eq!(val, 3_000);
}

/// Admin can override min_rate and the new value is returned.
#[test]
fn test_set_config_min_rate() {
    let env = setup_env();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    use crate::contract::{VestingDrips, VestingDripsClient};
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    client.initialize(&admin, &0u32, &treasury);

    client.set_config(&admin, &String::from_str(&env, "min_rate"), &5i128);

    let val = client.get_config(&String::from_str(&env, "min_rate"));
    assert_eq!(val, 5);
}

/// set_config rejects an out-of-range max_cliff_ratio.
#[test]
fn test_set_config_invalid_max_cliff_ratio_rejected() {
    let env = setup_env();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    use crate::contract::{VestingDrips, VestingDripsClient};
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    client.initialize(&admin, &0u32, &treasury);

    let err = client
        .try_set_config(&admin, &String::from_str(&env, "max_cliff_ratio"), &10_001i128)
        .unwrap_err();
    assert_eq!(err.unwrap_err(), VestingError::InvalidRate);
}

/// set_config rejects min_rate < 1.
#[test]
fn test_set_config_invalid_min_rate_rejected() {
    let env = setup_env();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    use crate::contract::{VestingDrips, VestingDripsClient};
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    client.initialize(&admin, &0u32, &treasury);

    let err = client
        .try_set_config(&admin, &String::from_str(&env, "min_rate"), &0i128)
        .unwrap_err();
    assert_eq!(err.unwrap_err(), VestingError::InvalidRate);
}

/// Non-admin cannot call set_config.
#[test]
fn test_set_config_unauthorized() {
    let env = setup_env();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let attacker = Address::generate(&env);

    use crate::contract::{VestingDrips, VestingDripsClient};
    let contract_id = env.register(VestingDrips, ());
    let client = VestingDripsClient::new(&env, &contract_id);
    client.initialize(&admin, &0u32, &treasury);

    let err = client
        .try_set_config(&attacker, &String::from_str(&env, "min_rate"), &5i128)
        .unwrap_err();
    assert_eq!(err.unwrap_err(), VestingError::Unauthorized);
}
