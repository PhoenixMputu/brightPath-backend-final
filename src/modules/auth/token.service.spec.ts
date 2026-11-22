import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import {
  hashRefreshToken,
  ROTATE_SESSION_SCRIPT,
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
  const redis = { set: vi.fn(), del: vi.fn(), eval: vi.fn() };
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

  describe('rotate', () => {
    const stored = (token: string) =>
      JSON.stringify({
        userId: 'u-1',
        refreshTokenHash: hashRefreshToken(token),
      });

    it('swaps the current refresh token atomically for a new pair in the same session', async () => {
      redis.eval.mockResolvedValue(1);

      const result = await service.rotate('u-1', 's-1', 'old.refresh');

      if (result.status !== 'rotated') throw new Error(result.status);
      const { tokens } = result;
      expect(tokens.sessionId).toBe('s-1');
      expect(redis.eval).toHaveBeenCalledWith(
        ROTATE_SESSION_SCRIPT,
        1,
        sessionKey('s-1'),
        'u-1',
        hashRefreshToken('old.refresh'),
        stored(tokens.refreshToken),
        env.JWT_REFRESH_TTL_SECONDS,
      );
      await expect(
        verify(tokens.accessToken, env.JWT_ACCESS_SECRET),
      ).resolves.toMatchObject({ sub: 'u-1', sid: 's-1', typ: 'access' });
      await expect(
        verify(tokens.refreshToken, env.JWT_REFRESH_SECRET),
      ).resolves.toMatchObject({ sub: 'u-1', sid: 's-1', typ: 'refresh' });
      expect(tokens.refreshToken).not.toBe('old.refresh');
    });

    it('never sends a raw refresh token to Redis', async () => {
      redis.eval.mockResolvedValue(1);
      const result = await service.rotate('u-1', 's-1', 'old.refresh');
      if (result.status !== 'rotated') throw new Error(result.status);

      const sent = JSON.stringify(redis.eval.mock.calls[0]);
      expect(sent).not.toContain('old.refresh');
      expect(sent).not.toContain(result.tokens.refreshToken);
    });

    it('reports a session that no longer exists', async () => {
      redis.eval.mockResolvedValue(0);
      await expect(
        service.rotate('u-1', 's-1', 'old.refresh'),
      ).resolves.toEqual({ status: 'unknown' });
    });

    it('reports a reused token (the script has already revoked the session)', async () => {
      redis.eval.mockResolvedValue(-1);
      await expect(
        service.rotate('u-1', 's-1', 'old.refresh'),
      ).resolves.toEqual({ status: 'reused' });
    });

    it('fails when Redis is unreachable', async () => {
      redis.eval.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.rotate('u-1', 's-1', 'old.refresh')).rejects.toThrow(
        'ECONNREFUSED',
      );
    });

    it('expects the user and token hash that issue stored for the session', async () => {
      const { refreshToken, sessionId } = await service.issue('u-1');
      const issued = JSON.parse(redis.set.mock.calls[0][1] as string) as {
        userId: string;
        refreshTokenHash: string;
      };
      redis.eval.mockResolvedValue(1);

      await service.rotate('u-1', sessionId, refreshToken);
      expect(redis.eval.mock.calls[0].slice(3, 5)).toEqual([
        issued.userId,
        issued.refreshTokenHash,
      ]);
    });
  });
});
