import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { Env } from '../../config/env.schema.js';
import { AuthCookiesResult, setAuthCookies } from './auth-cookies.js';

/**
 * Turns an AuthCookiesResult into httpOnly auth cookies plus a JSON body, so
 * controllers and services never touch the Response object. Use it with
 * `@UseInterceptors(AuthCookiesInterceptor)` on routes that open a session.
 *
 * Runs only on success: when the handler throws, nothing is set and the
 * exception filter answers as usual.
 */
@Injectable()
export class AuthCookiesInterceptor implements NestInterceptor {
  private readonly domain: string | undefined;

  constructor(config: ConfigService<Env, true>) {
    this.domain = config.get('COOKIE_DOMAIN', { infer: true });
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((result: unknown) => {
        if (!(result instanceof AuthCookiesResult)) {
          // A wiring bug, not a client error: the filter turns it into a 500.
          throw new TypeError(
            'AuthCookiesInterceptor expects the handler to return an AuthCookiesResult',
          );
        }
        setAuthCookies(res, result.tokens, this.domain);
        return result.body as unknown;
      }),
    );
  }
}
