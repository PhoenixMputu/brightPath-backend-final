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

/**
 * Outcome of a rotation:
 * - `rotated`: the presented token was the current one; here is the new pair.
 * - `unknown`: no such session (expired, revoked or never existed).
 * - `reused`: the session exists but the token is an older one. It was
 *   already rotated, so it has been stolen or replayed: the session is
 *   revoked.
 */
export type RotationResult =
  | { status: 'rotated'; tokens: AuthTokens }
  | { status: 'unknown' }
  | { status: 'reused' };

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

/** The one place a session is serialized. */
function serializeSession(userId: string, refreshToken: string): string {
  const session: StoredSession = {
    userId,
    refreshTokenHash: hashRefreshToken(refreshToken),
  };
  return JSON.stringify(session);
}

/**
 * Compare-and-set of a session, atomic in Redis so two concurrent refreshes
 * with the same token cannot both succeed. Only `userId` and
 * `refreshTokenHash` are compared, so adding a field to the session later
 * does not invalidate the sessions already stored.
 *
 * KEYS[1] session key; ARGV[1] user id; ARGV[2] hash of the presented token;
 * ARGV[3] new session value; ARGV[4] TTL in seconds.
 * Returns 1 rotated, 0 unknown, -1 reused or unreadable (session deleted).
 *
 * Any mismatch counts as reuse, including a client retrying after a lost
 * response or two tabs refreshing at once: the frontend must run a single
 * refresh at a time.
 */
export const ROTATE_SESSION_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local ok, session = pcall(cjson.decode, current)
if not ok or type(session) ~= 'table'
  or session.userId ~= ARGV[1]
  or session.refreshTokenHash ~= ARGV[2] then
  redis.call('DEL', KEYS[1])
  return -1
end
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
return 1
`;

/**
 * Issues and rotates the access and refresh JWTs of a session. The session
 * lives in Redis for as long as its refresh token, so it can be revoked
 * server-side (logout, rotation, reuse) before the token expires.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async issue(userId: string): Promise<AuthTokens> {
    const tokens = await this.signPair(userId, randomUUID());
    await this.redis.set(
      sessionKey(tokens.sessionId),
      serializeSession(userId, tokens.refreshToken),
      'EX',
      tokens.refreshTtlSeconds,
    );
    return tokens;
  }

  /**
   * Swaps the presented refresh token for a new pair in the same session.
   * The previous refresh token stops working at once, and the session gets
   * a full refresh lifetime again (sliding session).
   *
   * The token must already be verified (signature, expiry, `typ`) by the
   * refresh strategy; this checks it is still the session's current one.
   */
  async rotate(
    userId: string,
    sessionId: string,
    presentedRefreshToken: string,
  ): Promise<RotationResult> {
    const tokens = await this.signPair(userId, sessionId);
    const outcome = await this.redis.eval(
      ROTATE_SESSION_SCRIPT,
      1,
      sessionKey(sessionId),
      userId,
      hashRefreshToken(presentedRefreshToken),
      serializeSession(userId, tokens.refreshToken),
      tokens.refreshTtlSeconds,
    );
    if (outcome === 1) return { status: 'rotated', tokens };
    if (outcome === -1) return { status: 'reused' };
    return { status: 'unknown' };
  }

  /** Ends a session: its refresh token can no longer be used. */
  async revoke(sessionId: string): Promise<void> {
    await this.redis.del(sessionKey(sessionId));
  }

  private async signPair(
    userId: string,
    sessionId: string,
  ): Promise<AuthTokens> {
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

    return {
      sessionId,
      accessToken,
      refreshToken,
      accessTtlSeconds,
      refreshTtlSeconds,
    };
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
