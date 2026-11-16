import { validateEnv } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgres://user:secret-db-password@db.example.com:5432/app',
  REDIS_URL: 'rediss://default:secret-redis-password@redis.example.com:6379',
  RESEND_API_KEY: 're_test',
  MAIL_FROM: 'BrightPath <noreply@example.com>',
  CORS_ORIGINS: 'http://localhost:3000, https://app.example.com/',
};

describe('validateEnv', () => {
  it('applies defaults and converts types', () => {
    expect(validateEnv(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      PORT: 8000,
      PROVINCES_CACHE_TTL_SECONDS: 300,
      LOG_LEVEL: 'debug',
      SWAGGER_ENABLED: true,
      CORS_ORIGINS: ['http://localhost:3000', 'https://app.example.com'],
    });
  });

  it('parses numbers and drops unknown variables', () => {
    const env = validateEnv({
      ...valid,
      PORT: '3001',
      PROVINCES_CACHE_TTL_SECONDS: '120',
      PATH: '/usr/bin',
    });
    expect(env.PORT).toBe(3001);
    expect(env.PROVINCES_CACHE_TTL_SECONDS).toBe(120);
    expect(env).not.toHaveProperty('PATH');
  });

  it('defaults LOG_LEVEL to info in production', () => {
    expect(validateEnv({ ...valid, NODE_ENV: 'production' }).LOG_LEVEL).toBe(
      'info',
    );
    expect(
      validateEnv({ ...valid, NODE_ENV: 'production', LOG_LEVEL: 'warn' })
        .LOG_LEVEL,
    ).toBe('warn');
  });

  it('disables Swagger in production unless explicitly enabled', () => {
    expect(
      validateEnv({ ...valid, NODE_ENV: 'production' }).SWAGGER_ENABLED,
    ).toBe(false);
    expect(
      validateEnv({ ...valid, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })
        .SWAGGER_ENABLED,
    ).toBe(true);
    expect(
      validateEnv({ ...valid, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED,
    ).toBe(false);
  });

  it.each([
    ['SWAGGER_ENABLED', 'yes'],
    ['DATABASE_URL', undefined],
    ['DATABASE_URL', 'mysql://host/db'],
    ['REDIS_URL', 'http://redis.example.com'],
    ['PORT', 'abc'],
    ['PROVINCES_CACHE_TTL_SECONDS', '0'],
    ['LOG_LEVEL', 'verbose'],
    ['CORS_ORIGINS', '*'],
    ['RESEND_API_KEY', ''],
  ])('rejects %s=%j', (key, value) => {
    expect(() => validateEnv({ ...valid, [key]: value })).toThrow(
      new RegExp(`Invalid environment variables[\\s\\S]*${key}`),
    );
  });

  it('never echoes values in the error', () => {
    const run = () =>
      validateEnv({ ...valid, REDIS_URL: 'ftp://secret-redis-password@x' });
    expect(run).toThrow();
    try {
      run();
    } catch (err) {
      expect(String(err)).not.toContain('secret');
    }
  });
});
