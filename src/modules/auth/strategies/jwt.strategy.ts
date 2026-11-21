import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../../../common/decorators/current-user.decorator.js';
import type { Env } from '../../../config/env.schema.js';
import { ACCESS_TOKEN_COOKIE } from '../auth-cookies.js';

/**
 * Reads the access token from the httpOnly `access_token` cookie. The
 * Authorization header is deliberately not accepted: tokens only ever travel
 * in cookies.
 */
export function accessTokenFromCookie(req: Request): string | null {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[
    ACCESS_TOKEN_COOKIE
  ];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The 'jwt' strategy behind JwtAuthGuard. passport-jwt checks the signature
 * (access secret, HS256 only) and the expiry; `validate` then checks the
 * claims, so a refresh token can never pass as an access token.
 *
 * Stateless on purpose: the session is not looked up in Redis on every
 * request. A revoked session keeps working until its access token expires
 * (15 minutes by default); the refresh step is where revocation is enforced.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([accessTokenFromCookie]),
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  validate(payload: unknown): AuthUser {
    if (isAccessPayload(payload)) {
      return { userId: payload.sub, sessionId: payload.sid };
    }
    // The guard turns this into a 401 UNAUTHENTICATED.
    throw new UnauthorizedException();
  }
}

function isAccessPayload(
  payload: unknown,
): payload is { sub: string; sid: string; typ: 'access' } {
  if (typeof payload !== 'object' || payload === null) return false;
  const { sub, sid, typ } = payload as Record<string, unknown>;
  return (
    typ === 'access' &&
    typeof sub === 'string' &&
    sub.length > 0 &&
    typeof sid === 'string' &&
    sid.length > 0
  );
}
