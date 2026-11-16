import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  RedisThrottlerStorage,
  throttlerBlockKey,
  throttlerHitsKey,
} from './redis-throttler.storage.js';

describe('RedisThrottlerStorage', () => {
  const redis = { eval: vi.fn() };
  const storage = new RedisThrottlerStorage(redis as unknown as Redis);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('builds namespaced keys', () => {
    expect(throttlerHitsKey('default', 'ABC')).toBe(
      'brightpath:throttle:hits:default:abc',
    );
    expect(throttlerBlockKey('auth', 'abc')).toBe(
      'brightpath:throttle:block:auth:abc',
    );
  });

  it('runs the script on both keys and converts milliseconds to seconds', async () => {
    redis.eval.mockResolvedValue([3, 59_001, 0, 0]);

    await expect(
      storage.increment('abc', 60_000, 10, 60_000, 'default'),
    ).resolves.toEqual({
      totalHits: 3,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      2,
      'brightpath:throttle:hits:default:abc',
      'brightpath:throttle:block:default:abc',
      60_000,
      10,
      60_000,
    );
  });

  it('reports a block', async () => {
    redis.eval.mockResolvedValue([11, 30_000, 1, 45_500]);

    await expect(
      storage.increment('abc', 60_000, 10, 60_000, 'default'),
    ).resolves.toMatchObject({ isBlocked: true, timeToBlockExpire: 46 });
  });

  it('lets the request through when Redis fails', async () => {
    redis.eval.mockRejectedValue(new Error('Connection is closed'));

    await expect(
      storage.increment('abc', 60_000, 10, 60_000, 'default'),
    ).resolves.toEqual({
      totalHits: 0,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });
});
