import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { CacheService } from './cache.service.js';
import { REDIS_CLIENT } from './redis.constants.js';

const CONNECT_TIMEOUT_MS = 5_000;

function waitForReady(client: Redis, timeoutMs: number): Promise<boolean> {
  if (client.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.off('ready', onReady);
      resolve(false);
    }, timeoutMs);
    const onReady = () => {
      clearTimeout(timer);
      resolve(true);
    };
    client.once('ready', onReady);
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const logger = new Logger('Redis');
        const client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
          // Fail fast instead of queueing commands while Redis is unreachable:
          // CacheService then falls back to the database.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: CONNECT_TIMEOUT_MS,
        });
        client.on('error', (err) => logger.warn(err.message));

        // Without an offline queue, requests served before the connection is
        // ready would skip the cache: wait for it, but never block startup.
        const ready = await waitForReady(client, CONNECT_TIMEOUT_MS);
        if (!ready) {
          logger.warn(
            'Redis not ready at startup; serving uncached until it connects.',
          );
        }
        return client;
      },
    },
    CacheService,
  ],
  exports: [CacheService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
