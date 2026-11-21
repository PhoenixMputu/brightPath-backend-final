import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Who made the request, as set on `request.user` by the JWT strategy. */
export interface AuthUser {
  userId: string;
  sessionId: string;
}

/**
 * Injects the authenticated user into a handler parameter:
 * `me(@CurrentUser() user: AuthUser)`. Only for routes behind the auth guard
 * (not @Public()), where `request.user` is always set.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
