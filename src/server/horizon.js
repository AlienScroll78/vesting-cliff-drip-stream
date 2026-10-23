import { ConsecutiveBreaker, CircuitState, circuitBreaker, handleAll } from 'cockatiel';

export class HorizonManager {
  constructor(options = {}) {
    const rawEndpoints = options.endpoints ||
      (process.env.HORIZON_ENDPOINTS ? process.env.HORIZON_ENDPOINTS.split(',') : null) ||
      (process.env.HORIZON_URL ? [process.env.HORIZON_URL] : ['http://127.0.0.1:8666', 'https://horizon-testnet.stellar.org']);

    this.endpoints = rawEndpoints
      .slice(0, 3)
      .map(e => e.trim())
      .filter(Boolean)
      .map(url => {
        const breaker = circuitBreaker(handleAll, {
          halfOpenAfter: options.cooldownMs ?? 60000,
          breaker: new ConsecutiveBreaker(options.maxFailures ?? 3)
        });
        return {
          url,
          consecutiveFailures: 0,
          isHealthy: true,
          lastFailureTime: 0,
          breaker
        };
      });

    this.cooldownMs = options.cooldownMs ?? 60000;
    this.maxFailures = options.maxFailures ?? 3;
    this.roundRobinIndex = 0;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  getHealthyEndpoints() {
    const now = Date.now();
    return this.endpoints.filter(ep => {
      if (!ep.isHealthy) {
        if (now - ep.lastFailureTime >= this.cooldownMs) {
          // Half-open retry window
          return true;
        }
        return false;
      }
      return ep.breaker.state !== CircuitState.Open;
    });
  }

  async executeRequest(path = '/', fetchOptions = {}) {
    const healthy = this.getHealthyEndpoints();

    if (healthy.length === 0) {
      const err = new Error('All Horizon endpoints unavailable');
      err.status = 503;
      throw err;
    }

    let lastError = null;
    const startIndex = this.roundRobinIndex % healthy.length;

    for (let i = 0; i < healthy.length; i++) {
      const epIndex = (startIndex + i) % healthy.length;
      const ep = healthy[epIndex];
      this.roundRobinIndex = (this.roundRobinIndex + 1) % healthy.length;

      try {
        const targetUrl = new URL(path, ep.url).toString();
        const response = await ep.breaker.execute(async () => {
          const res = await this.fetchFn(targetUrl, {
            timeout: fetchOptions.timeout ?? 5000,
            ...fetchOptions
          });
          if (!res.ok && res.status >= 500) {
            throw new Error(`Horizon server error: ${res.status}`);
          }
          return res;
        });

        // Request succeeded
        ep.consecutiveFailures = 0;
        ep.isHealthy = true;
        return response;
      } catch (err) {
        lastError = err;
        ep.consecutiveFailures++;
        ep.lastFailureTime = Date.now();

        if (ep.consecutiveFailures >= this.maxFailures) {
          ep.isHealthy = false;
        }
        // Transparent failover: continue loop to next healthy endpoint
      }
    }

    const failure = new Error(`Horizon request failed on all endpoints: ${lastError?.message}`);
    failure.status = 503;
    throw failure;
  }

  getHealthStatus() {
    const healthy = this.getHealthyEndpoints();
    const isAnyHealthy = healthy.length > 0;
    const status = isAnyHealthy
      ? (healthy.length === this.endpoints.length ? 'healthy' : 'degraded')
      : 'unavailable';

    return {
      status,
      endpoints: this.endpoints.map(ep => ({
        url: ep.url,
        healthy: ep.isHealthy && ep.breaker.state !== CircuitState.Open,
        consecutiveFailures: ep.consecutiveFailures,
        circuitBreakerState: ep.breaker.state === CircuitState.Open ? 'open' : 'closed'
      }))
    };
  }

  getCircuitBreakerStatus() {
    const isOpen = this.endpoints.some(
      ep => !ep.isHealthy || ep.breaker.state === CircuitState.Open
    );
    return isOpen ? 'open' : 'closed';
  }

  getHorizonHealthHandler() {
    return async (req, res) => {
      try {
        const health = this.getHealthStatus();
        if (health.status === 'unavailable') {
          return res.status(503).json({
            status: 'unavailable',
            error: 'All Horizon endpoints down',
            endpoints: health.endpoints
          });
        }
        res.json({
          status: health.status,
          endpoints: health.endpoints.map(e => e.url)
        });
      } catch (err) {
        res.status(503).json({ status: 'unavailable', error: err.message });
      }
    };
  }

  getCircuitBreakerHandler() {
    return (req, res) => {
      const status = this.getCircuitBreakerStatus();
      if (req.headers.accept?.includes('application/json')) {
        return res.json({ status });
      }
      res.type('text/plain').send(status);
    };
  }
}
