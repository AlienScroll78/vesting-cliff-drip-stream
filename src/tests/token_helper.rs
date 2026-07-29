//! Lightweight helpers for creating and minting a mock SAC token in tests.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

// The soroban test framework ships a built-in token contract.
// We use `env.register_stellar_asset_contract_v2` to get a real SAC token.
use soroban_sdk::token::{StellarAssetClient, TokenClient as SdkTokenClient};

/// Deploys a Stellar Asset Contract token and returns `(contract_address, client)`.
pub fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, SdkTokenClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let address = sac.address();
    let client = SdkTokenClient::new(env, &address);
    (address, client)
}

/// Mints `amount` tokens to `to` using the admin/issuer capability of the SAC.
pub fn mint_to(env: &Env, token: &Address, to: &Address, amount: i128) {
    let admin_client = StellarAssetClient::new(env, token);
    admin_client.mint(to, &amount);
}
