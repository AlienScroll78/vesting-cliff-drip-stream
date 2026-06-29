import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadNetworkConfig } from "../config/network.js";

describe("network config", () => {
  const KEYS = ["STELLAR_NETWORK", "TESTNET_RPC_URL", "MAINNET_RPC_URL", "TESTNET_CONTRACT_ID", "MAINNET_CONTRACT_ID", "TESTNET_PASSPHRASE"];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it("defaults to testnet", () => {
    expect(loadNetworkConfig().network).toBe("testnet");
  });

  it("logs active network (testnet passphrase)", () => {
    process.env.STELLAR_NETWORK = "testnet";
    expect(loadNetworkConfig().networkPassphrase).toContain("Test SDF Network");
  });

  it("mainnet passphrase", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    expect(loadNetworkConfig().networkPassphrase).toContain("Public Global Stellar Network");
  });

  it("per-network RPC override via env", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.TESTNET_RPC_URL = "https://custom-rpc.example.com";
    expect(loadNetworkConfig().rpcUrl).toBe("https://custom-rpc.example.com");
  });

  it("throws on unrecognised network (fails fast)", () => {
    process.env.STELLAR_NETWORK = "badnet";
    expect(() => loadNetworkConfig()).toThrow(/not valid/);
  });

  it("sets contractId from env", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.TESTNET_CONTRACT_ID = "CABC123";
    expect(loadNetworkConfig().contractId).toBe("CABC123");
  });

  it("supports futurenet", () => {
    process.env.STELLAR_NETWORK = "futurenet";
    const cfg = loadNetworkConfig();
    expect(cfg.network).toBe("futurenet");
    expect(cfg.networkPassphrase).toContain("Future");
  });
});
