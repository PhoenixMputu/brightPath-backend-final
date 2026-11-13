import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CACHE_VERSION_TTL_SECONDS, CacheService } from './cache.service.js';

describe('CacheService', () => {
  const tx = { incr: vi.fn(), expire: vi.fn(), exec: vi.fn() };
  const redis = { get: vi.fn(), set: vi.fn(), multi: vi.fn() };
  const loader = vi.fn();
  let cache: CacheService;

  beforeEach(() => {
    vi.resetAllMocks();
    redis.multi.mockReturnValue(tx);
    tx.incr.mockReturnValue(tx);
    tx.expire.mockReturnValue(tx);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    cache = new CacheService(redis as unknown as Redis);
  });

  it('returns the cached value without calling the loader on a hit', async () => {
    redis.get.mockResolvedValueOnce('3').mockResolvedValueOnce('{"a":1}');

    await expect(cache.remember('ns', ['x', 1], 60, loader)).resolves.toEqual({
      a: 1,
    });
    expect(redis.get).toHaveBeenNthCalledWith(1, 'ns:version');
    expect(redis.get).toHaveBeenNthCalledWith(2, 'ns:v3:x:1');
    expect(loader).not.toHaveBeenCalled();
  });

  it('loads and stores the value with its TTL on a miss', async () => {
    redis.get.mockResolvedValue(null);
    loader.mockResolvedValue({ a: 1 });

    await expect(cache.remember('ns', ['x'], 60, loader)).resolves.toEqual({
      a: 1,
    });
    expect(redis.set).toHaveBeenCalledWith('ns:v0:x', '{"a":1}', 'EX', 60);
  });

  it('falls back to the loader when Redis is unreachable', async () => {
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    loader.mockResolvedValue({ a: 1 });

    await expect(cache.remember('ns', ['x'], 60, loader)).resolves.toEqual({
      a: 1,
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('still returns the loaded value when the cache write fails', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockRejectedValue(new Error('READONLY'));
    loader.mockResolvedValue({ a: 1 });

    await expect(cache.remember('ns', ['x'], 60, loader)).resolves.toEqual({
      a: 1,
    });
  });

  it('does not cache a loader failure', async () => {
    redis.get.mockResolvedValue(null);
    loader.mockRejectedValue(new Error('db down'));

    await expect(cache.remember('ns', ['x'], 60, loader)).rejects.toThrow(
      'db down',
    );
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('invalidates a namespace by bumping its version, with a TTL', async () => {
    await cache.invalidate('ns');
    expect(tx.incr).toHaveBeenCalledWith('ns:version');
    expect(tx.expire).toHaveBeenCalledWith(
      'ns:version',
      CACHE_VERSION_TTL_SECONDS,
    );
    expect(tx.exec).toHaveBeenCalled();
  });

  it('does not throw when invalidation fails', async () => {
    tx.exec.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(cache.invalidate('ns')).resolves.toBeUndefined();
  });
});
