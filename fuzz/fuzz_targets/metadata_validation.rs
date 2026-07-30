#![no_main]

use libfuzzer_sys::fuzz_target;

fn validate_address_like(data: &[u8]) -> bool {
    if data.is_empty() {
        return false;
    }
    data.len() == 32
}

fn validate_rate(rate: i128) -> Result<(), ()> {
    if rate <= 0 {
        return Err(());
    }
    if rate > i128::MAX / 2 {
        return Err(());
    }
    Ok(())
}

fn validate_duration(cliff: u32, total: u32) -> Result<(), ()> {
    if total <= cliff {
        return Err(());
    }
    if total == 0 || cliff == 0 {
        return Err(());
    }
    Ok(())
}

fuzz_target!(|data: &[u8]| {
    if data.is_empty() {
        let _ = validate_address_like(data);
        return;
    }

    let _ = String::from_utf8(data.to_vec());

    let _ = validate_address_like(data);

    if let Ok(s) = core::str::from_utf8(data) {
        let _ = s.len();
        let _ = s.chars().count();
    }

    if data.len() >= 16 {
        let mut arr = [0u8; 16];
        arr.copy_from_slice(&data[..16]);
        let rate = i128::from_le_bytes(arr);
        let _ = validate_rate(rate);
    }

    if data.len() >= 8 {
        let cliff = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        let total = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
        let _ = validate_duration(cliff, total);
    }

    let _ = (1i128).checked_mul(100);
});
