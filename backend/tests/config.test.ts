/**
 * Unit tests for backend/src/config.ts
 *
 * Uses parseConfig() with mock env maps so process.env is never mutated and
 * process.exit() is mocked to prevent test-runner termination.
 */

import { parseConfig } from '../src/config';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal valid environment that satisfies all required fields. */
const validEnv: NodeJS.ProcessEnv = {
  HORIZON_URL:           'https://horizon-testnet.stellar.org',
  NETWORK_PASSPHRASE:    'Test SDF Network ; September 2015',
  VESTING_CONTRACT_ID:   'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  DATABASE_URL:          'postgres://user:pass@localhost:5432/vesting',
  REDIS_URL:             'redis://localhost:6379',
  WEBHOOK_SECRET:        'super-secret-value-1234',
  JWT_SECRET:            'a-very-long-jwt-secret-that-is-at-least-32-chars',
};

/** Spy on process.exit and process.stderr.write to avoid side-effects. */
let exitSpy: jest.SpyInstance;
let stderrSpy: jest.SpyInstance;

beforeEach(() => {
  exitSpy = jest
    .spyOn(process, 'exit')
    .mockImplementation((_code?: string | number | null | undefined) => {
      throw new Error('process.exit called');
    });
  stderrSpy = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
});

afterEach(() => {
  exitSpy.mockRestore();
  stderrSpy.mockRestore();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseConfig', () => {
  describe('valid configuration', () => {
    it('returns a frozen config object with all required fields', () => {
      const cfg = parseConfig(validEnv);

      expect(cfg.horizonUrl).toBe('https://horizon-testnet.stellar.org');
      expect(cfg.networkPassphrase).toBe('Test SDF Network ; September 2015');
      expect(cfg.vestingContractId).toBe(
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      );
      expect(Object.isFrozen(cfg)).toBe(true);
    });

    it('applies default values for optional fields', () => {
      const cfg = parseConfig(validEnv);

      expect(cfg.port).toBe(3000);
      expect(cfg.nodeEnv).toBe('development');
      expect(cfg.dbPoolMax).toBe(10);
      expect(cfg.redisTtlSeconds).toBe(300);
      expect(cfg.otelServiceName).toBe('vesting-backend');
      expect(cfg.otelServiceVersion).toBe('0.0.0');
      expect(cfg.otelSampleRate).toBe(0.1);
      expect(cfg.jwtExpiresIn).toBe('1h');
      expect(cfg.corsAllOrigins).toBe(false);
      expect(cfg.logLevel).toBe('info');
      expect(cfg.otlpEndpoint).toBe('');
      expect(cfg.webhookAllowedUrls).toEqual([]);
    });

    it('coerces PORT string to number', () => {
      const cfg = parseConfig({ ...validEnv, PORT: '8080' });
      expect(cfg.port).toBe(8080);
      expect(typeof cfg.port).toBe('number');
    });

    it('coerces DB_POOL_MAX string to number', () => {
      const cfg = parseConfig({ ...validEnv, DB_POOL_MAX: '20' });
      expect(cfg.dbPoolMax).toBe(20);
    });

    it('coerces REDIS_TTL_SECONDS string to number', () => {
      const cfg = parseConfig({ ...validEnv, REDIS_TTL_SECONDS: '600' });
      expect(cfg.redisTtlSeconds).toBe(600);
    });

    it('coerces CORS_ALL_ORIGINS "true" to boolean true', () => {
      const cfg = parseConfig({ ...validEnv, CORS_ALL_ORIGINS: 'true' });
      expect(cfg.corsAllOrigins).toBe(true);
    });

    it('coerces CORS_ALL_ORIGINS "1" to boolean true', () => {
      const cfg = parseConfig({ ...validEnv, CORS_ALL_ORIGINS: '1' });
      expect(cfg.corsAllOrigins).toBe(true);
    });

    it('coerces CORS_ALL_ORIGINS "yes" to boolean true', () => {
      const cfg = parseConfig({ ...validEnv, CORS_ALL_ORIGINS: 'YES' });
      expect(cfg.corsAllOrigins).toBe(true);
    });

    it('coerces CORS_ALL_ORIGINS "false" to boolean false', () => {
      const cfg = parseConfig({ ...validEnv, CORS_ALL_ORIGINS: 'false' });
      expect(cfg.corsAllOrigins).toBe(false);
    });

    it('splits WEBHOOK_ALLOWED_URLS into an array', () => {
      const cfg = parseConfig({
        ...validEnv,
        WEBHOOK_ALLOWED_URLS: 'https://a.example.com, https://b.example.com',
      });
      expect(cfg.webhookAllowedUrls).toEqual([
        'https://a.example.com',
        'https://b.example.com',
      ]);
    });

    it('accepts valid NODE_ENV values', () => {
      for (const env of ['development', 'test', 'staging', 'production'] as const) {
        const cfg = parseConfig({ ...validEnv, NODE_ENV: env });
        expect(cfg.nodeEnv).toBe(env);
      }
    });

    it('accepts valid LOG_LEVEL values', () => {
      for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
        const cfg = parseConfig({ ...validEnv, LOG_LEVEL: level });
        expect(cfg.logLevel).toBe(level);
      }
    });

    it('accepts OTEL_SAMPLE_RATE as a float', () => {
      const cfg = parseConfig({ ...validEnv, OTEL_SAMPLE_RATE: '0.05' });
      expect(cfg.otelSampleRate).toBeCloseTo(0.05);
    });
  });

  describe('missing required variables', () => {
    const requiredKeys: Array<[string, keyof typeof validEnv]> = [
      ['HORIZON_URL',          'HORIZON_URL'],
      ['NETWORK_PASSPHRASE',   'NETWORK_PASSPHRASE'],
      ['VESTING_CONTRACT_ID',  'VESTING_CONTRACT_ID'],
      ['DATABASE_URL',         'DATABASE_URL'],
      ['REDIS_URL',            'REDIS_URL'],
      ['WEBHOOK_SECRET',       'WEBHOOK_SECRET'],
      ['JWT_SECRET',           'JWT_SECRET'],
    ];

    it.each(requiredKeys)(
      'exits with code 1 when %s is missing',
      (_label, key) => {
        const env = { ...validEnv };
        delete env[key];

        expect(() => parseConfig(env)).toThrow('process.exit called');
        expect(exitSpy).toHaveBeenCalledWith(1);
      },
    );
  });

  describe('invalid values', () => {
    it('rejects PORT outside 1-65535', () => {
      expect(() => parseConfig({ ...validEnv, PORT: '0' })).toThrow();
      expect(() => parseConfig({ ...validEnv, PORT: '99999' })).toThrow();
    });

    it('rejects invalid HORIZON_URL', () => {
      expect(() =>
        parseConfig({ ...validEnv, HORIZON_URL: 'not-a-url' }),
      ).toThrow();
    });

    it('rejects invalid DATABASE_URL', () => {
      expect(() =>
        parseConfig({ ...validEnv, DATABASE_URL: 'not-a-url' }),
      ).toThrow();
    });

    it('rejects REDIS_URL that is not a valid URL', () => {
      expect(() =>
        parseConfig({ ...validEnv, REDIS_URL: 'localhost:6379' }),
      ).toThrow();
    });

    it('rejects JWT_SECRET shorter than 32 characters', () => {
      expect(() =>
        parseConfig({ ...validEnv, JWT_SECRET: 'too-short' }),
      ).toThrow();
    });

    it('rejects WEBHOOK_SECRET shorter than 16 characters', () => {
      expect(() =>
        parseConfig({ ...validEnv, WEBHOOK_SECRET: 'short' }),
      ).toThrow();
    });

    it('rejects OTEL_SAMPLE_RATE above 1', () => {
      expect(() =>
        parseConfig({ ...validEnv, OTEL_SAMPLE_RATE: '1.5' }),
      ).toThrow();
    });

    it('rejects OTEL_SAMPLE_RATE below 0', () => {
      expect(() =>
        parseConfig({ ...validEnv, OTEL_SAMPLE_RATE: '-0.1' }),
      ).toThrow();
    });

    it('rejects invalid NODE_ENV', () => {
      expect(() =>
        parseConfig({ ...validEnv, NODE_ENV: 'staging-v2' }),
      ).toThrow();
    });

    it('rejects invalid LOG_LEVEL', () => {
      expect(() =>
        parseConfig({ ...validEnv, LOG_LEVEL: 'verbose' }),
      ).toThrow();
    });
  });

  describe('config object immutability', () => {
    it('is frozen and cannot be mutated', () => {
      const cfg = parseConfig(validEnv);
      expect(() => {
        // TypeScript will also catch this at compile time; we cast to bypass.
        (cfg as Record<string, unknown>).port = 9999;
      }).toThrow(TypeError);
      expect(cfg.port).toBe(3000);
    });
  });
});
