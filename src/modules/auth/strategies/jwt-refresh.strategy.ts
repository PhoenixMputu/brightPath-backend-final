import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../../config/env.schema.js';
import { REFRESH_TOKEN_COOKIE } from '../auth-cookies.js';

export const JWT_REFRESH_STRATEGY = 'jwt-refresh';

/** What the refresh strategy puts on `request.user`. */
export interface RefreshSession {
  userId: string;
  sessionId: string;
  /** The raw token, so the rotation can check it is the current one. */
  refreshToken: string;
}

/**
 * Reads the refresh token from the httpOnly `refresh_token` cookie, which the
 * browser only sends to the auth routes. Never from a header or the body.
 */
export function refreshTokenFromCookie(req: Request): string | null {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[
    REFRESH_TOKEN_COOKIE
  ];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The 'jwt-refresh' strategy behind JwtRefreshGuard: checks the signature
 * (refresh secret, HS256 only), the expiry and the claims, so an access
 * token can never pass as a refresh token.
 *
 * It does not look at Redis: whether the token is still the session's
 * current one is decided atomically by TokenService.rotate.
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  JWT_REFRESH_STRATEGY,
) {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([refreshTokenFromCookie]),
      secretOrKey: config.get('JWT_REFRESH_SECRET', { infer: true }),
      algorithms: ['HS256'],
      ignoreExpiration: false,
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: unknown): RefreshSession {
    const refreshToken = refreshTokenFromCookie(req);
    if (refreshToken && isRefreshPayload(payload)) {
      return { userId: payload.sub, sessionId: payload.sid, refreshToken };
    }
    // The guard turns this into a 401 REFRESH_TOKEN_INVALID.
    throw new UnauthorizedException();
  }
}

function isRefreshPayload(
  payload: unknown,
): payload is { sub: string; sid: string; typ: 'refresh' } {
  if (typeof payload !== 'object' || payload === null) return false;
  const { sub, sid, typ } = payload as Record<string, unknown>;
  return (
    typ === 'refresh' &&
    typeof sub === 'string' &&
    sub.length > 0 &&
    typeof sid === 'string' &&
    sid.length > 0
  );
}
