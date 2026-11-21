import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants.js';
import { redisKey } from '../../redis/redis-keys.js';
import { PasswordService } from './password.service.js';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
/** Wrong guesses allowed per code before it is burnt. */
export const OTP_MAX_ATTEMPTS = 5;
/** Minimum delay between two codes sent to the same user. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
/**
 * Attempts allowed per user over OTP_DAILY_WINDOW_SECONDS, across all codes.
 * Issuing a new code does not reset it, so resends cannot buy more guesses.
 */
export const OTP_DAILY_MAX_ATTEMPTS = 15;
export const OTP_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
/** Codes a user can ask to resend per OTP_RESEND_WINDOW_SECONDS. */
export const OTP_MAX_RESENDS = 5;
export const OTP_RESEND_WINDOW_SECONDS = 60 * 60;

export type OtpCheck =
  'valid' | 'invalid' | 'expired' | 'too_many_attempts' | 'locked';

export function otpKey(userId: string): string {
  return redisKey('auth', 'otp', userId);
}

export function otpAttemptsKey(userId: string): string {
  return redisKey('auth', 'otp-attempts', userId);
}

export function otpCooldownKey(userId: string): string {
  return redisKey('auth', 'otp-cooldown', userId);
}

export function otpDailyAttemptsKey(userId: string): string {
  return redisKey('auth', 'otp-daily-attempts', userId);
}

export function otpResendsKey(userId: string): string {
  return redisKey('auth', 'otp-resends', userId);
}

/**
 * One-time codes for email verification. Only the argon2id hash is stored,
 * in Redis, with a TTL; issuing a new code replaces the previous one.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Returns the plain code, to be sent to the user and never stored. Also
   * starts the resend cooldown.
   */
  async issue(userId: string): Promise<string> {
    const code = generateCode();
    const hash = await this.passwordService.hash(code);
    await this.redis
      .multi()
      .set(otpKey(userId), hash, 'EX', OTP_TTL_SECONDS)
      .del(otpAttemptsKey(userId))
      .set(otpCooldownKey(userId), '1', 'EX', OTP_RESEND_COOLDOWN_SECONDS)
      .exec();
    return code;
  }

  /**
   * Claims the right to send a new code. False while the cooldown of the
   * previous code runs; SET NX makes parallel requests claim it only once.
   */
  async tryStartCooldown(userId: string): Promise<boolean> {
    const result = await this.redis.set(
      otpCooldownKey(userId),
      '1',
      'EX',
      OTP_RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    return result === 'OK';
  }

  /** Lets the user ask again at once, e.g. after a failed send. */
  async clearCooldown(userId: string): Promise<void> {
    await this.redis.del(otpCooldownKey(userId));
  }

  /**
   * Counts a resend request. False once OTP_MAX_RESENDS is exceeded within
   * OTP_RESEND_WINDOW_SECONDS; the window starts at the first resend.
   */
  async tryCountResend(userId: string): Promise<boolean> {
    const count = await this.incrementWithin(
      otpResendsKey(userId),
      OTP_RESEND_WINDOW_SECONDS,
    );
    return count <= OTP_MAX_RESENDS;
  }

  /** True once the user has used up their daily attempts. */
  async isLocked(userId: string): Promise<boolean> {
    const value = await this.redis.get(otpDailyAttemptsKey(userId));
    return value !== null && Number(value) >= OTP_DAILY_MAX_ATTEMPTS;
  }

  /**
   * Checks `code` against the stored hash. A valid code is consumed. Every
   * check counts as an attempt, both for this code and for the user's daily
   * budget (counted atomically, so parallel guesses cannot exceed either
   * limit). Past either limit the code is deleted: after OTP_MAX_ATTEMPTS a new
   * code is needed, after OTP_DAILY_MAX_ATTEMPTS the user is locked until the
   * daily window ends.
   */
  async verify(userId: string, code: string): Promise<OtpCheck> {
    const hash = await this.redis.get(otpKey(userId));
    if (hash === null) return 'expired';

    const attemptsKey = otpAttemptsKey(userId);
    const dailyKey = otpDailyAttemptsKey(userId);
    const results = await this.redis
      .multi()
      .incr(attemptsKey)
      // Set only on the first attempt, so the window is not extended.
      .expire(attemptsKey, OTP_TTL_SECONDS, 'NX')
      .incr(dailyKey)
      .expire(dailyKey, OTP_DAILY_WINDOW_SECONDS, 'NX')
      .exec();
    const attempts = Number(results?.[0]?.[1]);
    const dailyAttempts = Number(results?.[2]?.[1]);
    if (
      !Number.isFinite(dailyAttempts) ||
      dailyAttempts > OTP_DAILY_MAX_ATTEMPTS
    ) {
      await this.revoke(userId);
      return 'locked';
    }
    if (!Number.isFinite(attempts) || attempts > OTP_MAX_ATTEMPTS) {
      await this.revoke(userId);
      return 'too_many_attempts';
    }

    if (!(await this.passwordService.verify(hash, code))) return 'invalid';

    // DEL is atomic: when two requests send the right code at once, only the
    // one that actually removes it is valid, so a code opens one session.
    const consumed = await this.redis.del(otpKey(userId));
    await this.redis.del(attemptsKey);
    return consumed === 1 ? 'valid' : 'expired';
  }

  /**
   * Revokes the current code and its attempts. The daily budget and the
   * resend counter are kept on purpose: they must outlive individual codes.
   */
  async revoke(userId: string): Promise<void> {
    await this.redis.del(otpKey(userId), otpAttemptsKey(userId));
  }

  /** INCR with a TTL set on the first hit only, so the window is fixed. */
  private async incrementWithin(
    key: string,
    ttlSeconds: number,
  ): Promise<number> {
    const results = await this.redis
      .multi()
      .incr(key)
      .expire(key, ttlSeconds, 'NX')
      .exec();
    const count = Number(results?.[0]?.[1]);
    // Fail closed: an unreadable counter counts as over the limit.
    return Number.isFinite(count) ? count : Number.POSITIVE_INFINITY;
  }
}

/** Uniform over 000000-999999, from a CSPRNG. */
function generateCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}
