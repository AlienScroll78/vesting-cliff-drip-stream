#![no_main]

use libfuzzer_sys::fuzz_target;

fn calculate_claimable(
    current_ledger: u32,
    _start_ledger: u32,
    cliff_ledger: u32,
    end_ledger: u32,
    last_claimed_ledger: u32,
    rate: i128,
) -> Result<i128, ()> {
    if current_ledger < cliff_ledger {
        return Err(());
    }
    if current_ledger < last_claimed_ledger {
        return Err(());
    }
    let active_end = current_ledger.min(end_ledger);
    if active_end < last_claimed_ledger {
        return Err(());
    }
    let claimable_ledgers = active_end - last_claimed_ledger;
    let claimable = (claimable_ledgers as i128).checked_mul(rate).ok_or(())?;
    if claimable == 0 {
        return Err(());
    }
    Ok(claimable)
}

fuzz_target!(|data: &[u8]| {
    if data.len() < 24 {
        return;
    }

    let (current_bytes, rest) = data.split_at(4);
    let current = u32::from_le_bytes([current_bytes[0], current_bytes[1], current_bytes[2], current_bytes[3]]);

    let (start_bytes, rest) = rest.split_at(4);
    let start = u32::from_le_bytes([start_bytes[0], start_bytes[1], start_bytes[2], start_bytes[3]]);

    let (cliff_bytes, rest) = rest.split_at(4);
    let cliff = u32::from_le_bytes([cliff_bytes[0], cliff_bytes[1], cliff_bytes[2], cliff_bytes[3]]);

    let (end_bytes, rest) = rest.split_at(4);
    let end = u32::from_le_bytes([end_bytes[0], end_bytes[1], end_bytes[2], end_bytes[3]]);

    let (last_bytes, rate_bytes) = rest.split_at(4);
    let last = u32::from_le_bytes([last_bytes[0], last_bytes[1], last_bytes[2], last_bytes[3]]);

    let mut arr = [0u8; 16];
    let copy_len = rate_bytes.len().min(16);
    arr[..copy_len].copy_from_slice(&rate_bytes[..copy_len]);
    let rate = i128::from_le_bytes(arr);

    let _ = calculate_claimable(current, start, cliff, end, last, rate);
});
