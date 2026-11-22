import { UnauthorizedException } from '@nestjs/common';

export const REFRESH_TOKEN_INVALID_CODE = 'REFRESH_TOKEN_INVALID';

/**
 * One answer for every refresh failure (missing, expired, forged, revoked,
 * reused token, inactive account): the client must sign in again, and the
 * reason is not detailed so it does not help an attacker.
 */
export function refreshTokenInvalid(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: REFRESH_TOKEN_INVALID_CODE,
    message: 'Session expired, please sign in again',
  });
}
