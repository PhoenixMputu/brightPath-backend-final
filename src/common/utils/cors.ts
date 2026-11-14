import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

/**
 * Parses CORS_ORIGINS, a comma-separated allowlist of origins
 * (e.g. "http://localhost:3000,https://app.brightpath.cd").
 * Throws when it is missing or empty, so the app fails fast at startup.
 */
export function parseCorsOrigins(value: string | undefined): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must list at least one allowed origin');
  }
  for (const origin of origins) {
    if (origin === '*' || !URL.canParse(origin) || new URL(origin).origin !== origin) {
      throw new Error(`CORS_ORIGINS contains an invalid origin: "${origin}"`);
    }
  }
  return origins;
}

/** CORS for the frontend: explicit allowlist, cookies allowed. */
export function buildCorsOptions(origins: string[]): CorsOptions {
  return {
    origin: origins,
    // Auth tokens travel in httpOnly cookies.
    credentials: true,
  };
}
