import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { refreshTokenInvalid } from '../refresh-token-invalid.js';
import { JWT_REFRESH_STRATEGY } from '../strategies/jwt-refresh.strategy.js';

/**
 * Route guard for POST /auth/refresh, used with @Public() (the access token
 * is usually expired by then). Any failure answers 401 REFRESH_TOKEN_INVALID.
 */
@Injectable()
export class JwtRefreshGuard extends AuthGuard(JWT_REFRESH_STRATEGY) {
  override handleRequest<TUser>(err: unknown, user: TUser | false): TUser {
    if (!err && user) return user;
    // An unexpected error is a bug, not a bad token: let the filter log it
    // as a 500 instead of silently signing the user out.
    if (err && !(err instanceof UnauthorizedException)) throw err;
    throw refreshTokenInvalid();
  }
}
