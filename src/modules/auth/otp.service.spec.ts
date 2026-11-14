import { Redis } from 'ioredis';
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  OtpService,
} from './otp.service.js';
import { PasswordService } from './password.service.js';

describe('OtpService', () => {
  const tx = {
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    exec: vi.fn(),
  };
  const redis = { get: vi.fn(), del: vi.fn(), multi: vi.fn() };
  const passwordService = new PasswordService();
  const service = new OtpService(redis as unknown as Redis, passwordService);

  const KEY = 'brightpath:auth:otp:u-1';
  const ATTEMPTS_KEY = 'brightpath:auth:otp-attempts:u-1';

  beforeEach(() => {
    vi.resetAllMocks();
    redis.multi.mockReturnValue(tx);
    for (const cmd of [tx.set, tx.del, tx.incr, tx.expire]) {
      cmd.mockReturnValue(tx);
    }
  });

  /** Makes the next attempt counter read `n`. */
  const attempt = (n: number) =>
    tx.exec.mockResolvedValue([
      [null, n],
      [null, 1],
    ]);

  describe('issue', () => {
    it('returns a 6-digit code, stores only its hash with a TTL and resets attempts', async () => {
      const code = await service.issue('u-1');

      expect(code).toMatch(/^\d{6}$/);
      expect(tx.set).toHaveBeenCalledWith(
        KEY,
        expect.stringMatching(/^\$argon2id\$/),
        'EX',
        OTP_TTL_SECONDS,
      );
      expect(tx.del).toHaveBeenCalledWith(ATTEMPTS_KEY);
      const stored = tx.set.mock.calls[0][1] as string;
      expect(stored).not.toContain(code);
      await expect(passwordService.verify(stored, code)).resolves.toBe(true);
    });

    it('generates a different code each time', async () => {
      const codes = new Set(
        await Promise.all(
          Array.from({ length: 5 }, () => service.issue('u-1')),
        ),
      );
      expect(codes.size).toBeGreaterThan(1);
    });

    it('fails when Redis cannot store the code', async () => {
      tx.exec.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.issue('u-1')).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('verify', () => {
    let hash: string;
    beforeAll(async () => {
      hash = await passwordService.hash('042137');
    });

    it('accepts the right code and consumes it', async () => {
      redis.get.mockResolvedValue(hash);
      attempt(1);

      await expect(service.verify('u-1', '042137')).resolves.toBe('valid');
      expect(redis.get).toHaveBeenCalledWith(KEY);
      expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
    });

    it('counts the attempt with a TTL that is not extended', async () => {
      redis.get.mockResolvedValue(hash);
      attempt(1);

      await service.verify('u-1', '042137');
      expect(tx.incr).toHaveBeenCalledWith(ATTEMPTS_KEY);
      expect(tx.expire).toHaveBeenCalledWith(
        ATTEMPTS_KEY,
        OTP_TTL_SECONDS,
        'NX',
      );
    });

    it('rejects a wrong code and keeps it for another try', async () => {
      redis.get.mockResolvedValue(hash);
      attempt(OTP_MAX_ATTEMPTS);

      await expect(service.verify('u-1', '000000')).resolves.toBe('invalid');
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('reports a missing code as expired without counting an attempt', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.verify('u-1', '042137')).resolves.toBe('expired');
      expect(redis.multi).not.toHaveBeenCalled();
    });

    it('burns the code past the attempt limit, even if the guess is right', async () => {
      redis.get.mockResolvedValue(hash);
      attempt(OTP_MAX_ATTEMPTS + 1);

      await expect(service.verify('u-1', '042137')).resolves.toBe(
        'too_many_attempts',
      );
      expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
    });

    it('fails closed when the attempt counter cannot be read', async () => {
      redis.get.mockResolvedValue(hash);
      tx.exec.mockResolvedValue(null);

      await expect(service.verify('u-1', '042137')).resolves.toBe(
        'too_many_attempts',
      );
    });
  });

  it('revokes a code and its attempts', async () => {
    await service.revoke('u-1');
    expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
  });
});
