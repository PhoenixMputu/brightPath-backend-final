import { TimeoutError, withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100)).resolves.toBe('ok');
  });

  it('propagates the rejection of the promise', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 100),
    ).rejects.toThrow('boom');
  });

  it('rejects with a TimeoutError when the promise is too slow', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => undefined), 50);
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});
