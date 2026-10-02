//! db-tests — PostgreSQL integration test suite (issue #792).
//!
//! Run with:
//!   cargo test -p db-tests
//!
//! Requires Docker to be running (testcontainers will pull postgres:16-alpine).

pub mod db;
pub mod helpers;

#[cfg(test)]
mod tests;

fn main() {
    println!("Run `cargo test -p db-tests` to execute the integration test suite.");
}
