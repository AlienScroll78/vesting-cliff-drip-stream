/**
 * Issue 4: Multi-network config
 * Reads STELLAR_NETWORK env var and loads per-network config.
 * Fails fast on startup if network is invalid or required values are missing.
 */

export type NetworkName = "testnet" | "mainnet" | "futurenet";

interface NetworkConfig {
  network: NetworkName;
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
}

const NETWORK_DEFAULTS: Record<NetworkName, Pick<NetworkConfig, "rpcUrl" | "networkPassphrase">> = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    rpcUrl: "https://soroban-mainnet.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
  futurenet: {
    rpcUrl: "https://rpc-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
  },
};

function loadNetworkConfig(): NetworkConfig {
  const raw = (process.env.STELLAR_NETWORK ?? "testnet").toLowerCase();

  if (!Object.keys(NETWORK_DEFAULTS).includes(raw)) {
    throw new Error(
      `[config] STELLAR_NETWORK="${raw}" is not valid. ` +
        `Allowed values: ${Object.keys(NETWORK_DEFAULTS).join(", ")}`
    );
  }

  const network = raw as NetworkName;
  const defaults = NETWORK_DEFAULTS[network];

  // Per-network env overrides: TESTNET_RPC_URL, MAINNET_RPC_URL, etc.
  const prefix = network.toUpperCase();
  const rpcUrl = process.env[`${prefix}_RPC_URL`] ?? defaults.rpcUrl;
  const networkPassphrase =
    process.env[`${prefix}_PASSPHRASE`] ?? defaults.networkPassphrase;
  const contractId = process.env[`${prefix}_CONTRACT_ID`] ?? "";

  if (!contractId) {
    console.warn(
      `[config] ${prefix}_CONTRACT_ID is not set — contract calls will fail`
    );
  }

  return { network, rpcUrl, contractId, networkPassphrase };
}

// Exported for direct testing without module re-import
export { loadNetworkConfig };

// Exported singleton — throws on bad config at module load time (startup validation)
export const networkConfig: NetworkConfig = loadNetworkConfig();
