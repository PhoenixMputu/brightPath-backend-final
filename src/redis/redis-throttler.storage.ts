import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';
import { redisKey } from './redis-keys.js';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

/**
 * Counts hits and applies the block atomically. Both keys always get a TTL
 * (the window for the counter, the block duration for the block flag).
 * Returns [totalHits, hitsTtlMs, isBlocked, blockTtlMs].
 */
const INCREMENT_SCRIPT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl, limit, block = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or limit + 1)
  return {hits, math.max(redis.call('PTTL', hitsKey), 0), 1, blockTtl}
end

local hits = redis.call('INCR', hitsKey)
local hitsTtl = redis.call('PTTL', hitsKey)
if hitsTtl < 0 then
  redis.call('PEXPIRE', hitsKey, ttl)
  hitsTtl = ttl
end

if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', block)
  return {hits, hitsTtl, 1, block}
end
return {hits, hitsTtl, 0, 0}
`;

export function throttlerHitsKey(throttlerName: string, key: string): string {
  return redisKey('throttle', 'hits', throttlerName, key);
}

export function throttlerBlockKey(throttlerName: string, key: string): string {
  return redisKey('throttle', 'block', throttlerName, key);
}

/**
 * Rate-limit storage on the shared Redis connection, so limits hold across
 * instances. If Redis is unreachable the request is let through (with a
 * warning): rate limiting must not turn a Redis outage into an API outage.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const result = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        throttlerHitsKey(throttlerName, key),
        throttlerBlockKey(throttlerName, key),
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];
      const [totalHits, hitsTtlMs, isBlocked, blockTtlMs] = result;
      return {
        totalHits,
        timeToExpire: Math.ceil(hitsTtlMs / 1000),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: Math.ceil(blockTtlMs / 1000),
      };
    } catch (err) {
      this.logger.warn({ err, throttlerName }, 'Rate limit check skipped');
      return {
        totalHits: 0,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
