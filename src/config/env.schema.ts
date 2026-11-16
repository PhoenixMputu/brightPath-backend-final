import { z } from 'zod';
import { parseCorsOrigins } from '../common/utils/cors.js';

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

/** "true" / "false" only: z.coerce.boolean() would read "false" as true. */
const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8000),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    PROVINCES_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),

    /** Defaults to `info` in production and `debug` elsewhere. */
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),

    RESEND_API_KEY: z.string().min(1),
    MAIL_FROM: z.string().min(1),

    /** Swagger UI at /docs. Defaults to on, except in production. */
    SWAGGER_ENABLED: booleanFlag.optional(),

    CORS_ORIGINS: z.string().transform((value, ctx) => {
      try {
        return parseCorsOrigins(value);
      } catch (err) {
        ctx.addIssue({
          code: 'custom',
          message: err instanceof Error ? err.message : 'Invalid CORS_ORIGINS',
        });
        return z.NEVER;
      }
    }),
  })
  .transform((env) => ({
    ...env,
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
    LOG_LEVEL:
      env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  }));

export type Env = z.output<typeof envSchema>;

/**
 * Validates the environment at startup (ConfigModule `validate`), so the app
 * fails fast on a missing or invalid variable. Zod issues never include the
 * received values, so no secret ends up in the error.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
