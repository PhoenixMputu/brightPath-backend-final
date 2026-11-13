import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { withTimeout } from '../common/utils/with-timeout.js';
import { REDIS_CLIENT } from './redis.constants.js';

export const REDIS_HEALTH_TIMEOUT_MS = 1_000;

@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Redis only backs the cache and the app falls back to the database without
   * it, so an outage is reported as `degraded` (HTTP 200), not `down` (503):
   * taking every instance out of rotation would turn a slower API into an
   * outage.
   */
  async isHealthy<const Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await withTimeout(this.redis.ping(), REDIS_HEALTH_TIMEOUT_MS);
      return indicator.up();
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${String(err)}`);
      return indicator.degraded({ message: 'Redis is unreachable' });
    }
  }
}
