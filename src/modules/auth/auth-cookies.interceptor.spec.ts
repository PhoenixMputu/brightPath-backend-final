import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { firstValueFrom, of } from 'rxjs';
import {
  ACCESS_TOKEN_COOKIE,
  AuthCookiesResult,
  REFRESH_TOKEN_COOKIE,
} from './auth-cookies.js';
import { AuthCookiesInterceptor } from './auth-cookies.interceptor.js';

describe('AuthCookiesInterceptor', () => {
  const tokens = {
    sessionId: 's-1',
    accessToken: 'access.jwt',
    refreshToken: 'refresh.jwt',
    accessTtlSeconds: 900,
    refreshTtlSeconds: 604_800,
  };
  const res = { cookie: vi.fn(), setHeader: vi.fn() };
  const context = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ExecutionContext;
  const handlerReturning = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });
  const interceptorWith = (domain?: string) =>
    new AuthCookiesInterceptor({
      get: () => domain,
    } as unknown as ConfigService<Env, true>);

  beforeEach(() => vi.resetAllMocks());

  const run = (interceptor: AuthCookiesInterceptor, value: unknown) =>
    firstValueFrom(interceptor.intercept(context, handlerReturning(value)));

  it('sends only the body and moves the tokens into cookies', async () => {
    const body = { message: 'ok' };

    await expect(
      run(interceptorWith(), new AuthCookiesResult(body, tokens)),
    ).resolves.toBe(body);
    expect(res.cookie).toHaveBeenCalledWith(ACCESS_TOKEN_COOKIE, 'access.jwt', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 900_000,
    });
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'refresh.jwt',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/api/v1/auth',
        maxAge: 604_800_000,
      },
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('scopes both cookies to COOKIE_DOMAIN when it is set', async () => {
    await run(
      interceptorWith('.brightpath.cd'),
      new AuthCookiesResult({}, tokens),
    );

    for (const [, , options] of res.cookie.mock.calls) {
      expect(options).toMatchObject({ domain: '.brightpath.cd' });
    }
  });

  it('fails loudly when the handler does not return an AuthCookiesResult', async () => {
    await expect(run(interceptorWith(), { message: 'ok' })).rejects.toThrow(
      TypeError,
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
