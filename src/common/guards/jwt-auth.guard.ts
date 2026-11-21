import {
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

export const UNAUTHENTICATED_CODE = 'UNAUTHENTICATED';
export const ACCESS_TOKEN_EXPIRED_CODE = 'ACCESS_TOKEN_EXPIRED';

/**
 * Global guard (APP_GUARD): every route needs a valid access token, except
 * those marked @Public(). The token is checked by the 'jwt' Passport
 * strategy.
 *
 * Failures answer 401 with a stable code: ACCESS_TOKEN_EXPIRED when the
 * token is only expired (the client should refresh it), UNAUTHENTICATED for
 * everything else (missing, malformed, wrong signature, wrong type). The
 * reason is never detailed further, so the answer does not help forge a
 * token.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;
    return super.canActivate(context);
  }

  override handleRequest<TUser>(
    err: unknown,
    user: TUser | false,
    info: unknown,
  ): TUser {
    if (!err && user) return user;

    const expired = info instanceof Error && info.name === 'TokenExpiredError';
    throw new UnauthorizedException(
      expired
        ? {
            statusCode: 401,
            code: ACCESS_TOKEN_EXPIRED_CODE,
            message: 'Access token expired, refresh it',
          }
        : {
            statusCode: 401,
            code: UNAUTHENTICATED_CODE,
            message: 'Authentication required',
          },
    );
  }
}
