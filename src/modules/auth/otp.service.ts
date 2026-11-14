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

export type OtpCheck = 'valid' | 'invalid' | 'expired' | 'too_many_attempts';

export function otpKey(userId: string): string {
  return redisKey('auth', 'otp', userId);
}

export function otpAttemptsKey(userId: string): string {
  return redisKey('auth', 'otp-attempts', userId);
}

export function otpCooldownKey(userId: string): string {
  return redisKey('auth', 'otp-cooldown', userId);
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
   * Checks `code` against the stored hash. A valid code is consumed. Every
   * check counts as an attempt (counted atomically, so parallel guesses cannot
   * exceed the limit); past OTP_MAX_ATTEMPTS the code is deleted and a new one
   * must be issued.
   */
  async verify(userId: string, code: string): Promise<OtpCheck> {
    const hash = await this.redis.get(otpKey(userId));
    if (hash === null) return 'expired';

    const attemptsKey = otpAttemptsKey(userId);
    const results = await this.redis
      .multi()
      .incr(attemptsKey)
      // Set only on the first attempt, so the window is not extended.
      .expire(attemptsKey, OTP_TTL_SECONDS, 'NX')
      .exec();
    const attempts = Number(results?.[0]?.[1]);
    if (!Number.isFinite(attempts) || attempts > OTP_MAX_ATTEMPTS) {
      await this.revoke(userId);
      return 'too_many_attempts';
    }

    if (!(await this.passwordService.verify(hash, code))) return 'invalid';

    await this.revoke(userId);
    return 'valid';
  }

  async revoke(userId: string): Promise<void> {
    await this.redis.del(otpKey(userId), otpAttemptsKey(userId));
  }
}

/** Uniform over 000000-999999, from a CSPRNG. */
function generateCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}
