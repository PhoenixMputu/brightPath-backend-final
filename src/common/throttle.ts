/** Default limit for every route, per client IP. */
export const DEFAULT_THROTTLE = { limit: 100, ttl: 60_000 } as const;

/**
 * Stricter limit for sensitive routes (registration, OTP, login, password
 * reset), applied with `@Throttle({ default: SENSITIVE_THROTTLE })`.
 */
export const SENSITIVE_THROTTLE = { limit: 10, ttl: 60_000 } as const;

export const THROTTLE_ERROR_MESSAGE =
  'Too many requests, please try again later';
