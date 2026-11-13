const APP_PREFIX = 'brightpath';

/**
 * Builds a Redis key as `brightpath:<domain>:<purpose>[:<id>...]`, lowercase.
 * Every Redis key must be built through this helper (see AGENTS.md).
 */
export function redisKey(
  domain: string,
  purpose: string,
  ...ids: ReadonlyArray<string | number>
): string {
  return [APP_PREFIX, domain, purpose, ...ids].join(':').toLowerCase();
}
