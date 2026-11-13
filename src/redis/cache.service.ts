import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

/**
 * TTL of a namespace's version counter, refreshed on every invalidation.
 * It must stay far above any entry TTL: once it expires the version restarts
 * at 0, which is only safe because every older entry has expired by then.
 */
export const CACHE_VERSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Read-through cache on top of Redis, grouped by namespace.
 *
 * Each namespace has a version counter that is part of every key. Invalidating
 * a namespace bumps the counter, so all its entries become unreachable at once
 * (no SCAN/DEL) and expire on their own through their TTL.
 *
 * Redis is never a hard dependency: on any Redis error the loader is called
 * and the result is served uncached.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async remember<T>(
    namespace: string,
    keyParts: ReadonlyArray<string | number>,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    let key: string;
    try {
      const version = (await this.redis.get(this.versionKey(namespace))) ?? '0';
      key = [namespace, `v${version}`, ...keyParts].join(':');
      const cached = await this.redis.get(key);
      if (cached !== null) return JSON.parse(cached) as T;
    } catch (err) {
      this.logger.warn(`Cache read skipped for "${namespace}": ${String(err)}`);
      return loader();
    }

    const value = await loader();
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Cache write skipped for "${key}": ${String(err)}`);
    }
    return value;
  }

  async invalidate(namespace: string): Promise<void> {
    try {
      const key = this.versionKey(namespace);
      await this.redis
        .multi()
        .incr(key)
        .expire(key, CACHE_VERSION_TTL_SECONDS)
        .exec();
    } catch (err) {
      // Entries of this namespace stay readable until their TTL expires.
      this.logger.error(
        `Cache invalidation failed for "${namespace}": ${String(err)}`,
      );
    }
  }

  private versionKey(namespace: string) {
    return `${namespace}:version`;
  }
}
