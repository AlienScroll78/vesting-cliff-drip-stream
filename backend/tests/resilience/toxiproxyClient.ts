/**
 * Minimal Toxiproxy v2 REST client for resilience tests.
 *
 * Toxiproxy control API docs:
 *   https://github.com/Shopify/toxiproxy#toxics
 *
 * Usage:
 *   const tp = new ToxiproxyClient();
 *   const proxy = await tp.getProxy('horizon');
 *
 *   // Add a 3-second latency toxic on the downstream side
 *   await proxy.addToxic({ type: 'latency', stream: 'downstream',
 *                           attributes: { latency: 3000, jitter: 0 } });
 *   // … run assertions …
 *   await proxy.removeAllToxics();
 */

import * as http from 'http';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToxicAttributes {
  [key: string]: number | string | boolean;
}

export interface Toxic {
  name:       string;
  type:       string;
  stream:     'upstream' | 'downstream';
  toxicity:   number;
  attributes: ToxicAttributes;
}

export interface ProxyConfig {
  name:     string;
  listen:   string;
  upstream: string;
  enabled:  boolean;
  toxics:   Toxic[];
}

// ── ToxiproxyClient ───────────────────────────────────────────────────────────

export class ToxiproxyClient {
  private readonly baseUrl: string;

  constructor(
    host = process.env.TOXIPROXY_HOST ?? 'localhost',
    port = parseInt(process.env.TOXIPROXY_PORT ?? '8474', 10),
  ) {
    this.baseUrl = `http://${host}:${port}`;
  }

  async getProxy(name: string): Promise<Proxy> {
    const data = await this.request<ProxyConfig>('GET', `/proxies/${name}`);
    return new Proxy(this.baseUrl, data);
  }

  async reset(): Promise<void> {
    await this.request('POST', '/reset');
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.request('GET', '/version');
      return true;
    } catch {
      return false;
    }
  }

  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: this.baseUrl.replace('http://', '').split(':')[0],
        port:     parseInt(this.baseUrl.split(':')[2] ?? '8474', 10),
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
        },
      };

      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`Toxiproxy ${method} ${path} → ${res.statusCode}: ${text}`));
          }
          try {
            resolve(text ? JSON.parse(text) as T : undefined as T);
          } catch {
            resolve(text as unknown as T);
          }
        });
      });

      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
}

// ── Proxy ─────────────────────────────────────────────────────────────────────

export class Proxy {
  constructor(
    private readonly baseUrl: string,
    private readonly config: ProxyConfig,
  ) {}

  get name(): string { return this.config.name; }

  private client(): ToxiproxyClient {
    const url = new URL(this.baseUrl);
    return new ToxiproxyClient(url.hostname, parseInt(url.port, 10));
  }

  async addToxic(toxic: Omit<Toxic, 'name'> & { name?: string }): Promise<Toxic> {
    const payload = {
      name:       toxic.name ?? `${toxic.type}_${Date.now()}`,
      type:       toxic.type,
      stream:     toxic.stream ?? 'downstream',
      toxicity:   toxic.toxicity ?? 1.0,
      attributes: toxic.attributes ?? {},
    };
    return this.client().request<Toxic>(
      'POST',
      `/proxies/${this.config.name}/toxics`,
      payload,
    );
  }

  async removeToxic(name: string): Promise<void> {
    await this.client().request('DELETE', `/proxies/${this.config.name}/toxics/${name}`);
  }

  async removeAllToxics(): Promise<void> {
    const proxy = await this.client().request<ProxyConfig>(
      'GET',
      `/proxies/${this.config.name}`,
    );
    for (const toxic of (proxy as ProxyConfig).toxics ?? []) {
      await this.removeToxic(toxic.name);
    }
  }

  /** Disable the proxy entirely (simulates service being down). */
  async disable(): Promise<void> {
    await this.client().request('POST', `/proxies/${this.config.name}/disable`);
  }

  /** Re-enable a previously disabled proxy. */
  async enable(): Promise<void> {
    await this.client().request('POST', `/proxies/${this.config.name}/enable`);
  }
}

// ── Utility: sleep ────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
