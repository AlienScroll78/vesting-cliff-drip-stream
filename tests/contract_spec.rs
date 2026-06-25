//! Contract-spec validation test.
//!
//! Reads the compiled WASM's `contractspecv0` custom section, decodes every
//! XDR `ScSpecEntry`, and asserts that the public API matches the expected
//! schema.  A name-rename, added/removed parameter, or changed return type
//! will cause this test to fail before any client code is affected.
//!
//! Run with:  cargo test --test contract_spec  (after `cargo build --release`)

use std::collections::HashMap;

use stellar_xdr::curr::{ReadXdr, ScSpecEntry, ScSpecTypeDef, Limits};
use wasmparser::{Parser, Payload};

// ── WASM path ────────────────────────────────────────────────────────────────

const WASM: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/target/wasm32-unknown-unknown/release/vesting_cliff_drip_stream.wasm"
);

// ── Expected schema ───────────────────────────────────────────────────────────

/// Minimal per-function expectation: (input_param_names, has_result_output).
/// `has_result_output` is true when the function returns a value (not void).
struct Expect {
    inputs: &'static [&'static str],
    /// Whether the function's `outputs` vec is non-empty.
    has_output: bool,
}

fn expected_schema() -> HashMap<&'static str, Expect> {
    let mut m = HashMap::new();

    m.insert(
        "create_vesting_stream",
        Expect {
            inputs: &["sponsor", "recipient", "token", "rate", "cliff_duration", "total_duration"],
            has_output: true,
        },
    );
    m.insert(
        "cancel_stream",
        Expect {
            inputs: &["sponsor", "recipient"],
            has_output: true,
        },
    );
    m.insert(
        "claim_vested",
        Expect {
            inputs: &["recipient"],
            has_output: true,
        },
    );
    m.insert(
        "get_schedule",
        Expect {
            inputs: &["recipient"],
            has_output: true,
        },
    );
    m.insert(
        "claimable_amount",
        Expect {
            inputs: &["recipient"],
            has_output: true,
        },
    );
    m.insert(
        "is_cliff_passed",
        Expect {
            inputs: &["recipient"],
            has_output: true,
        },
    );

    m
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn load_spec_entries() -> Vec<ScSpecEntry> {
    let wasm = std::fs::read(WASM)
        .unwrap_or_else(|_| panic!("WASM not found at {WASM}\nRun `cargo build --target wasm32-unknown-unknown --release` first."));

    let mut spec_bytes: Option<Vec<u8>> = None;

    for payload in Parser::new(0).parse_all(&wasm) {
        if let Payload::CustomSection(cs) = payload.expect("malformed WASM") {
            if cs.name() == "contractspecv0" {
                spec_bytes = Some(cs.data().to_vec());
                break;
            }
        }
    }

    let bytes = spec_bytes.expect("no `contractspecv0` custom section found in WASM");

    ScSpecEntry::read_xdr_iter(&mut stellar_xdr::curr::Limited::new(
        std::io::Cursor::new(bytes),
        Limits::none(),
    ))
    .collect::<Result<Vec<_>, _>>()
    .expect("failed to decode contract spec XDR")
}

/// Collect only `FunctionV0` entries, keyed by name.
fn function_entries() -> HashMap<String, stellar_xdr::curr::ScSpecFunctionV0> {
    load_spec_entries()
        .into_iter()
        .filter_map(|e| match e {
            ScSpecEntry::FunctionV0(f) => {
                let name = String::from_utf8(f.name.0.to_vec()).expect("non-UTF8 fn name");
                Some((name, f))
            }
            _ => None,
        })
        .collect()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn all_expected_functions_are_present() {
    let fns = function_entries();
    for name in expected_schema().keys() {
        assert!(fns.contains_key(*name), "missing function in contract spec: `{name}`");
    }
}

#[test]
fn no_unexpected_public_functions() {
    let schema = expected_schema();
    let fns = function_entries();
    for name in fns.keys() {
        assert!(
            schema.contains_key(name.as_str()),
            "unexpected public function in contract spec: `{name}` — update the schema in tests/contract_spec.rs"
        );
    }
}

#[test]
fn function_input_params_match() {
    let schema = expected_schema();
    let fns = function_entries();

    for (name, expect) in &schema {
        let f = fns.get(*name).unwrap_or_else(|| panic!("function `{name}` not in spec"));

        // Check parameter count.
        assert_eq!(
            f.inputs.len(),
            expect.inputs.len(),
            "function `{name}`: expected {} inputs, got {}",
            expect.inputs.len(),
            f.inputs.len(),
        );

        // Check parameter names in order.
        for (i, &expected_name) in expect.inputs.iter().enumerate() {
            let actual = String::from_utf8(f.inputs[i].name.0.to_vec())
                .expect("non-UTF8 param name");
            assert_eq!(
                actual, expected_name,
                "function `{name}` param[{i}]: expected `{expected_name}`, got `{actual}`"
            );
        }
    }
}

#[test]
fn function_outputs_match() {
    let schema = expected_schema();
    let fns = function_entries();

    for (name, expect) in &schema {
        let f = fns.get(*name).unwrap_or_else(|| panic!("function `{name}` not in spec"));

        if expect.has_output {
            assert!(
                !f.outputs.is_empty(),
                "function `{name}`: expected a return value but spec has none"
            );
        } else {
            assert!(
                f.outputs.is_empty(),
                "function `{name}`: expected void return but spec has output"
            );
        }
    }
}

/// Spot-check specific return types for the most critical functions.
#[test]
fn critical_return_types() {
    let fns = function_entries();

    // create_vesting_stream → Result<(), VestingError>  ⟹  ScSpecTypeDef::Result
    let create = &fns["create_vesting_stream"];
    assert!(
        matches!(create.outputs.first(), Some(ScSpecTypeDef::Result(_))),
        "create_vesting_stream: expected Result return type, got {:?}",
        create.outputs.first()
    );

    // claim_vested → Result<i128, VestingError>  ⟹  ScSpecTypeDef::Result
    let claim = &fns["claim_vested"];
    assert!(
        matches!(claim.outputs.first(), Some(ScSpecTypeDef::Result(_))),
        "claim_vested: expected Result return type, got {:?}",
        claim.outputs.first()
    );

    // claimable_amount → i128  ⟹  ScSpecTypeDef::I128
    let claimable = &fns["claimable_amount"];
    assert!(
        matches!(claimable.outputs.first(), Some(ScSpecTypeDef::I128)),
        "claimable_amount: expected I128 return type, got {:?}",
        claimable.outputs.first()
    );

    // is_cliff_passed → bool  ⟹  ScSpecTypeDef::Bool
    let cliff = &fns["is_cliff_passed"];
    assert!(
        matches!(cliff.outputs.first(), Some(ScSpecTypeDef::Bool)),
        "is_cliff_passed: expected Bool return type, got {:?}",
        cliff.outputs.first()
    );
}
