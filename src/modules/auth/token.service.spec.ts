import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import {
  hashRefreshToken,
  sessionKey,
  type TokenPayload,
  TokenService,
} from './token.service.js';

describe('TokenService', () => {
  const env = {
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'r'.repeat(32),
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_SECONDS: 604_800,
  };
  const config = { get: (key: keyof typeof env) => env[key] };
  const redis = { set: vi.fn(), del: vi.fn() };
  const jwt = new JwtService({});
  const service = new TokenService(
    jwt,
    config as unknown as ConfigService<Env, true>,
    redis as unknown as Redis,
  );

  beforeEach(() => vi.resetAllMocks());

  const verify = (token: string, secret: string) =>
    jwt.verifyAsync<TokenPayload & { iat: number; exp: number; jti: string }>(
      token,
      { secret, algorithms: ['HS256'] },
    );

  it('signs an access token with the access secret and lifetime', async () => {
    const { accessToken, sessionId } = await service.issue('u-1');

    const claims = await verify(accessToken, env.JWT_ACCESS_SECRET);
    expect(claims).toMatchObject({ sub: 'u-1', sid: sessionId, typ: 'access' });
    expect(claims.exp - claims.iat).toBe(env.JWT_ACCESS_TTL_SECONDS);
  });

  it('signs a refresh token with the refresh secret and lifetime', async () => {
    const { refreshToken, sessionId } = await service.issue('u-1');

    const claims = await verify(refreshToken, env.JWT_REFRESH_SECRET);
    expect(claims).toMatchObject({
      sub: 'u-1',
      sid: sessionId,
      typ: 'refresh',
    });
    expect(claims.exp - claims.iat).toBe(env.JWT_REFRESH_TTL_SECONDS);
  });

  it('never lets one secret verify the other token', async () => {
    const { accessToken, refreshToken } = await service.issue('u-1');

    await expect(verify(accessToken, env.JWT_REFRESH_SECRET)).rejects.toThrow();
    await expect(verify(refreshToken, env.JWT_ACCESS_SECRET)).rejects.toThrow();
  });

  it('stores the session with only a hash of the refresh token, for as long as it lives', async () => {
    const { refreshToken, sessionId } = await service.issue('u-1');

    expect(redis.set).toHaveBeenCalledWith(
      sessionKey(sessionId),
      JSON.stringify({
        userId: 'u-1',
        refreshTokenHash: hashRefreshToken(refreshToken),
      }),
      'EX',
      env.JWT_REFRESH_TTL_SECONDS,
    );
    const stored = redis.set.mock.calls[0][1] as string;
    expect(stored).not.toContain(refreshToken);
  });

  it('returns the lifetimes the cookies must use', async () => {
    await expect(service.issue('u-1')).resolves.toMatchObject({
      accessTtlSeconds: 900,
      refreshTtlSeconds: 604_800,
    });
  });

  it('opens a distinct session with distinct tokens each time', async () => {
    const [first, second] = await Promise.all([
      service.issue('u-1'),
      service.issue('u-1'),
    ]);

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it('fails when the session cannot be stored', async () => {
    redis.set.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.issue('u-1')).rejects.toThrow('ECONNREFUSED');
  });

  it('builds session keys with the shared helper', () => {
    expect(sessionKey('S-1')).toBe('brightpath:auth:session:s-1');
  });

  it('revokes a session by deleting it', async () => {
    await service.revoke('s-1');
    expect(redis.del).toHaveBeenCalledWith('brightpath:auth:session:s-1');
  });
});
