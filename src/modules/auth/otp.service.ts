import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.constants.js';
import { redisKey } from '../../redis/redis-keys.js';
import { PasswordService } from './password.service.js';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;

export function otpKey(userId: string): string {
  return redisKey('auth', 'otp', userId);
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

  /** Returns the plain code, to be sent to the user and never stored. */
  async issue(userId: string): Promise<string> {
    const code = generateCode();
    const hash = await this.passwordService.hash(code);
    await this.redis.set(otpKey(userId), hash, 'EX', OTP_TTL_SECONDS);
    return code;
  }

  async revoke(userId: string): Promise<void> {
    await this.redis.del(otpKey(userId));
  }
}

/** Uniform over 000000-999999, from a CSPRNG. */
function generateCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, '0');
}
