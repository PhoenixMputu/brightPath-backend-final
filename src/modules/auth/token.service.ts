import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.schema.js';
import { REDIS_CLIENT } from '../../redis/redis.constants.js';
import { redisKey } from '../../redis/redis-keys.js';

/** Claims of both tokens. `typ` stops one kind from being used as the other. */
export interface TokenPayload {
  sub: string;
  sid: string;
  typ: 'access' | 'refresh';
}

/** A signed pair, plus what the cookies need to expire with the tokens. */
export interface AuthTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

/** What Redis keeps per session: never the refresh token itself. */
interface StoredSession {
  userId: string;
  refreshTokenHash: string;
}

export function sessionKey(sessionId: string): string {
  return redisKey('auth', 'session', sessionId);
}

/**
 * SHA-256 rather than argon2: the refresh token is a signed JWT with a random
 * id, so it has far too much entropy to brute-force; a slow hash only fits
 * low-entropy secrets such as passwords and OTPs.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issues the access and refresh JWTs of a new session. The session lives in
 * Redis for as long as the refresh token, so it can be revoked server-side
 * (logout, rotation) before the token expires.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async issue(userId: string): Promise<AuthTokens> {
    const sessionId = randomUUID();
    const accessTtlSeconds = this.config.get('JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });
    const refreshTtlSeconds = this.config.get('JWT_REFRESH_TTL_SECONDS', {
      infer: true,
    });

    const [accessToken, refreshToken] = await Promise.all([
      this.sign(
        { sub: userId, sid: sessionId, typ: 'access' },
        this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        accessTtlSeconds,
      ),
      this.sign(
        { sub: userId, sid: sessionId, typ: 'refresh' },
        this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        refreshTtlSeconds,
      ),
    ]);

    const session: StoredSession = {
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
    };
    await this.redis.set(
      sessionKey(sessionId),
      JSON.stringify(session),
      'EX',
      refreshTtlSeconds,
    );

    return {
      sessionId,
      accessToken,
      refreshToken,
      accessTtlSeconds,
      refreshTtlSeconds,
    };
  }

  /** Ends a session: its refresh token can no longer be used. */
  async revoke(sessionId: string): Promise<void> {
    await this.redis.del(sessionKey(sessionId));
  }

  private sign(
    payload: TokenPayload,
    secret: string,
    expiresIn: number,
  ): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret,
      expiresIn,
      algorithm: 'HS256',
      // A unique id per token, so two tokens issued in the same second differ.
      jwtid: randomUUID(),
    });
  }
}
