//! Test helpers: spin up an isolated PostgreSQL database per test using
//! testcontainers-rs.  Each helper returns an owned `Client` connected to a
//! freshly migrated database whose name is unique to the test run.

use testcontainers::ContainerAsync;
use testcontainers_modules::postgres::Postgres;
use tokio_postgres::{Client, NoTls};
use uuid::Uuid;

use crate::db::run_migrations;

/// A running container + an open client for an isolated test database.
///
/// Keeping the `ContainerAsync` alive ensures Docker does not stop the
/// container until this handle is dropped at the end of the test.
pub struct TestDb {
    /// Connected client for the isolated test database.
    pub client: Client,
    // Container must stay alive while client is in use.
    _container: ContainerAsync<Postgres>,
}

/// Spin up a Postgres container, create a unique database, run all migrations,
/// and return a `TestDb` ready for assertions.
pub async fn setup_db() -> TestDb {
    use testcontainers::runners::AsyncRunner;

    // Start a Postgres 16 container (image pulled from Docker Hub).
    let container = Postgres::default()
        .start()
        .await
        .expect("failed to start Postgres container");

    let host_port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("failed to get host port");

    // Connect to the default `postgres` database first to create an isolated DB.
    let (admin_client, conn) = tokio_postgres::connect(
        &format!(
            "host=localhost port={} user=postgres password=postgres dbname=postgres",
            host_port
        ),
        NoTls,
    )
    .await
    .expect("failed to connect to postgres");

    tokio::spawn(async move {
        if let Err(e) = conn.await {
            eprintln!("admin connection error: {}", e);
        }
    });

    // Unique database name per test to guarantee isolation.
    let db_name = format!("test_{}", Uuid::new_v4().simple());
    admin_client
        .execute(&format!("CREATE DATABASE \"{}\"", db_name), &[])
        .await
        .expect("failed to create test database");

    // Connect to the freshly created database.
    let (client, conn) = tokio_postgres::connect(
        &format!(
            "host=localhost port={} user=postgres password=postgres dbname={}",
            host_port, db_name
        ),
        NoTls,
    )
    .await
    .expect("failed to connect to test database");

    tokio::spawn(async move {
        if let Err(e) = conn.await {
            eprintln!("test connection error: {}", e);
        }
    });

    // Apply all migrations.
    run_migrations(&client)
        .await
        .expect("migrations failed");

    TestDb {
        client,
        _container: container,
    }
}

/// Unique Stellar-style address for test fixtures (not valid on-chain, just unique strings).
pub fn unique_address(prefix: &str) -> String {
    format!("G{}{}", prefix.to_uppercase(), Uuid::new_v4().simple())
}
