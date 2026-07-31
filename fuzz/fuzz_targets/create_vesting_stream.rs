#![no_main]

use libfuzzer_sys::fuzz_target;

fn calculate_total_deposit(rate: i128, total_duration: u32) -> Result<i128, ()> {
    rate.checked_mul(total_duration as i128).ok_or(())
}

fuzz_target!(|data: &[u8]| {
    if data.len() < 20 {
        return;
    }

    let (rate_bytes, rest) = data.split_at(16);
    let mut arr = [0u8; 16];
    arr.copy_from_slice(rate_bytes);
    let rate = i128::from_le_bytes(arr);

    let (cliff_bytes, total_bytes) = rest.split_at(4);
    let _cliff = u32::from_le_bytes([cliff_bytes[0], cliff_bytes[1], cliff_bytes[2], cliff_bytes[3]]);

    if total_bytes.len() < 4 {
        return;
    }
    let total = u32::from_le_bytes([total_bytes[0], total_bytes[1], total_bytes[2], total_bytes[3]]);

    let _ = calculate_total_deposit(rate, total);
});
