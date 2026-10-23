import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadNetworkConfig } from "../config/network.js";

describe("network config", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const KEYS = ["STELLAR_NETWORK", "TESTNET_RPC_URL", "MAINNET_RPC_URL", "TESTNET_CONTRACT_ID", "MAINNET_CONTRACT_ID", "TESTNET_PASSPHRASE"];

  beforeEach(() => {
    for (const k of KEYS) savedEnv[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("defaults to testnet", () => {
    const cfg = loadNetworkConfig();
    expect(cfg.network).toBe("testnet");
  });

  it("uses testnet passphrase for testnet", () => {
    process.env.STELLAR_NETWORK = "testnet";
    const cfg = loadNetworkConfig();
    expect(cfg.networkPassphrase).toContain("Test SDF Network");
  });

  it("uses mainnet passphrase for mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    const cfg = loadNetworkConfig();
    expect(cfg.networkPassphrase).toContain("Public Global Stellar Network");
  });

  it("allows per-network RPC override via env", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.TESTNET_RPC_URL = "https://custom-rpc.example.com";
    const cfg = loadNetworkConfig();
    expect(cfg.rpcUrl).toBe("https://custom-rpc.example.com");
  });

  it("throws on unrecognised network", () => {
    process.env.STELLAR_NETWORK = "badnet";
    expect(() => loadNetworkConfig()).toThrow(/not valid/);
  });

  it("sets contractId from env", () => {
    process.env.STELLAR_NETWORK = "testnet";
    process.env.TESTNET_CONTRACT_ID = "CABC123";
    const cfg = loadNetworkConfig();
    expect(cfg.contractId).toBe("CABC123");
  });

  it("supports futurenet", () => {
    process.env.STELLAR_NETWORK = "futurenet";
    const cfg = loadNetworkConfig();
    expect(cfg.network).toBe("futurenet");
    expect(cfg.networkPassphrase).toContain("Future");
  });
});
