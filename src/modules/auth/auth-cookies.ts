import type { CookieOptions, Response } from 'express';
import { API_PREFIX } from '../../common/api-prefix.js';
import type { AuthTokens } from './token.service.js';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * The refresh token is only sent to the auth routes (refresh, logout), never
 * with every API call, which keeps it off most requests and logs.
 */
export const REFRESH_TOKEN_COOKIE_PATH = `/${API_PREFIX}/auth`;

/**
 * What a handler returns to have the auth cookies set: the interceptor puts
 * `tokens` in cookies and sends only `body`, so tokens never reach the JSON.
 */
export class AuthCookiesResult<T> {
  constructor(
    readonly body: T,
    readonly tokens: AuthTokens,
  ) {}
}

function baseOptions(domain: string | undefined): CookieOptions {
  return {
    // Unreadable from JavaScript, so an XSS cannot steal the tokens.
    httpOnly: true,
    // HTTPS only. Chrome and Firefox still accept it on http://localhost;
    // Safari may not, so develop locally with one of those or over HTTPS.
    secure: true,
    // Not sent on cross-site requests: blocks CSRF on the cookie-based auth.
    // Requires the frontend on the same site as the API (e.g. app. and api.
    // of one domain); a frontend on another domain would never send them.
    sameSite: 'strict',
    ...(domain ? { domain } : {}),
  };
}

export function setAuthCookies(
  res: Response,
  tokens: AuthTokens,
  domain: string | undefined,
): void {
  const options = baseOptions(domain);
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...options,
    path: '/',
    maxAge: tokens.accessTtlSeconds * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...options,
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: tokens.refreshTtlSeconds * 1000,
  });
  // A response that sets credentials must never be stored by a cache.
  res.setHeader('Cache-Control', 'no-store');
}
