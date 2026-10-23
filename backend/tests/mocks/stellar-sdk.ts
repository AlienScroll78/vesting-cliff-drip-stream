/**
 * Deterministic `@stellar/stellar-sdk` stub for snapshot tests.
 *
 * The real SDK is an optional peer dependency and performs live network
 * calls, so snapshot tests alias `@stellar/stellar-sdk` to this module
 * (see `vitest.snapshot.config.ts`).
 *
 * The stub reproduces only the surface used by the backend:
 *   - `Address.fromString(...).toScVal()`
 *   - `Address.fromScVal(...)` / `scValToNative(...)`
 *   - `nativeToScVal(...)`
 *   - `Contract`, `TransactionBuilder`, `SorobanRpc.Server`, `BASE_FEE`
 *
 * Simulated return values are driven by `setSimulatedResults`, which lets
 * each snapshot test pin the exact contract output it expects.
 */

/** Canonical testnet-style addresses used across the snapshot fixtures. */
export const TEST_RECIPIENT_A =
  "GC3Q2YBF4Z4X6KMTQKGHWJ2LRYFWX3DPEBQJHY5WELGBUIHKQIMT3ZAA";
export const TEST_RECIPIENT_B =
  "GA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAO7FY6YTQ3GAA";
export const TEST_SPONSOR =
  "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
export const TEST_CONTRACT_ID =
  "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAO7FY6YTQ3GAA";

export interface ScVal {
  __scval: string;
  value(): unknown;
}

function scVal(native: unknown): ScVal {
  return {
    __scval: "mock",
    value: () => native,
  };
}

/** Values returned by the next `simulateTransaction` call, keyed by method. */
const simulated = new Map<string, unknown>();

export function setSimulatedResults(results: Record<string, unknown>): void {
  simulated.clear();
  for (const [method, value] of Object.entries(results)) {
    simulated.set(method, value);
  }
}

export function resetSimulatedResults(): void {
  simulated.clear();
}

export const BASE_FEE = "100";

export class Address {
  private constructor(public readonly value: string) {}

  static fromString(address: string): Address {
    return new Address(address);
  }

  static fromScVal(value: any): Address {
    return new Address(value.value());
  }

  toString(): string {
    return this.value;
  }

  toScVal(): ScVal {
    return scVal(this.value);
  }
}

export function nativeToScVal(native: unknown, _opts?: unknown): ScVal {
  return scVal(native);
}

export function scValToNative(value: any): unknown {
  return value.value();
}

export class Contract {
  constructor(public readonly id: string) {}

  call(method: string, ...args: unknown[]): { method: string; args: unknown[] } {
    return { method, args };
  }
}

export class TransactionBuilder {
  private readonly operations: unknown[] = [];

  constructor(
    public readonly source: unknown,
    public readonly opts: unknown,
  ) {}

  addOperation(operation: unknown): TransactionBuilder {
    this.operations.push(operation);
    return this;
  }

  setTimeout(_seconds: number): TransactionBuilder {
    return this;
  }

  build(): { operations: unknown[] } {
    return { operations: this.operations };
  }
}

export class SorobanRpc {
  static Server = class Server {
    constructor(public readonly url: string) {}

    async simulateTransaction(tx: { operations: Array<{ method: string }> }): Promise<{
      result: { retval: ScVal };
    }> {
      const method = tx.operations[0]?.method ?? "";
      const value = simulated.get(method);
      if (value === undefined) {
        throw new Error(`No simulated result registered for method "${method}"`);
      }
      return { result: { retval: scVal(value) } };
    }
  };
}

export default {
  Address,
  Contract,
  TransactionBuilder,
  SorobanRpc,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
};
