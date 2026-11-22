import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RefreshSession } from '../strategies/jwt-refresh.strategy.js';

/**
 * Injects the session behind the refresh token into a handler parameter.
 * Only for routes behind JwtRefreshGuard, where `request.user` is always set.
 */
export const CurrentRefreshSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RefreshSession =>
    context.switchToHttp().getRequest<{ user: RefreshSession }>().user,
);
