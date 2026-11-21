import { Redis } from 'ioredis';
import {
  OTP_DAILY_MAX_ATTEMPTS,
  OTP_DAILY_WINDOW_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESENDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_RESEND_WINDOW_SECONDS,
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
  const redis = { get: vi.fn(), set: vi.fn(), del: vi.fn(), multi: vi.fn() };
  const passwordService = new PasswordService();
  const service = new OtpService(redis as unknown as Redis, passwordService);

  const KEY = 'brightpath:auth:otp:u-1';
  const ATTEMPTS_KEY = 'brightpath:auth:otp-attempts:u-1';
  const COOLDOWN_KEY = 'brightpath:auth:otp-cooldown:u-1';
  const DAILY_KEY = 'brightpath:auth:otp-daily-attempts:u-1';
  const RESENDS_KEY = 'brightpath:auth:otp-resends:u-1';

  beforeEach(() => {
    vi.resetAllMocks();
    redis.multi.mockReturnValue(tx);
    for (const cmd of [tx.set, tx.del, tx.incr, tx.expire]) {
      cmd.mockReturnValue(tx);
    }
    // DEL reports one key removed unless a test says otherwise.
    redis.del.mockResolvedValue(1);
  });

  /** Makes the next attempt read `n` on this code and `daily` for the user. */
  const attempt = (n: number, daily = n) =>
    tx.exec.mockResolvedValue([
      [null, n],
      [null, 1],
      [null, daily],
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
      expect(tx.set).toHaveBeenCalledWith(
        COOLDOWN_KEY,
        '1',
        'EX',
        OTP_RESEND_COOLDOWN_SECONDS,
      );
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

    it('does not reset the daily attempts, so a new code buys no extra guesses', async () => {
      await service.issue('u-1');

      const touched = [
        ...tx.del.mock.calls,
        ...tx.set.mock.calls,
        ...redis.del.mock.calls,
        ...redis.set.mock.calls,
      ].flat();
      expect(touched).not.toContain(DAILY_KEY);
      expect(touched).not.toContain(RESENDS_KEY);
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
      expect(redis.del).toHaveBeenCalledWith(KEY);
      expect(redis.del).toHaveBeenCalledWith(ATTEMPTS_KEY);
    });

    it('lets only one of two concurrent right guesses through', async () => {
      redis.get.mockResolvedValue(hash);
      attempt(1);
      // The other request deleted the code between our check and our DEL.
      redis.del.mockResolvedValueOnce(0);

      await expect(service.verify('u-1', '042137')).resolves.toBe('expired');
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

    it('fails closed when the attempt counters cannot be read', async () => {
      redis.get.mockResolvedValue(hash);
      tx.exec.mockResolvedValue(null);

      await expect(service.verify('u-1', '042137')).resolves.toBe('locked');
      expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
    });

    it('counts the attempt in the daily budget with a 24-hour TTL that is not extended', async () => {
      redis.get.mockResolvedValue(hash);
      attempt(1);

      await service.verify('u-1', '042137');
      expect(tx.incr).toHaveBeenCalledWith(DAILY_KEY);
      expect(tx.expire).toHaveBeenCalledWith(
        DAILY_KEY,
        OTP_DAILY_WINDOW_SECONDS,
        'NX',
      );
    });

    it('accepts the last attempt of the daily budget', async () => {
      redis.get.mockResolvedValue(hash);
      attempt(1, OTP_DAILY_MAX_ATTEMPTS);

      await expect(service.verify('u-1', '042137')).resolves.toBe('valid');
    });

    it('locks the user past the daily budget, even on a fresh code with a right guess', async () => {
      redis.get.mockResolvedValue(hash);
      attempt(1, OTP_DAILY_MAX_ATTEMPTS + 1);

      await expect(service.verify('u-1', '042137')).resolves.toBe('locked');
      expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
    });
  });

  it('revokes a code and its attempts, but keeps the daily budget', async () => {
    await service.revoke('u-1');
    expect(redis.del).toHaveBeenCalledOnce();
    expect(redis.del).toHaveBeenCalledWith(KEY, ATTEMPTS_KEY);
  });

  describe('isLocked', () => {
    it.each([
      [null, false],
      [String(OTP_DAILY_MAX_ATTEMPTS - 1), false],
      [String(OTP_DAILY_MAX_ATTEMPTS), true],
    ])('with %s daily attempts is %s', async (stored, expected) => {
      redis.get.mockResolvedValue(stored);

      await expect(service.isLocked('u-1')).resolves.toBe(expected);
      expect(redis.get).toHaveBeenCalledWith(DAILY_KEY);
    });
  });

  describe('resend limit', () => {
    const count = (n: number) =>
      tx.exec.mockResolvedValue([
        [null, n],
        [null, 1],
      ]);

    it('counts resends in a fixed one-hour window', async () => {
      count(1);

      await expect(service.tryCountResend('u-1')).resolves.toBe(true);
      expect(tx.incr).toHaveBeenCalledWith(RESENDS_KEY);
      expect(tx.expire).toHaveBeenCalledWith(
        RESENDS_KEY,
        OTP_RESEND_WINDOW_SECONDS,
        'NX',
      );
    });

    it('allows exactly OTP_MAX_RESENDS per window', async () => {
      count(OTP_MAX_RESENDS);
      await expect(service.tryCountResend('u-1')).resolves.toBe(true);

      count(OTP_MAX_RESENDS + 1);
      await expect(service.tryCountResend('u-1')).resolves.toBe(false);
    });

    it('fails closed when the counter cannot be read', async () => {
      tx.exec.mockResolvedValue(null);
      await expect(service.tryCountResend('u-1')).resolves.toBe(false);
    });
  });

  describe('resend cooldown', () => {
    it('is claimed atomically with SET NX and a TTL', async () => {
      redis.set.mockResolvedValue('OK');

      await expect(service.tryStartCooldown('u-1')).resolves.toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        COOLDOWN_KEY,
        '1',
        'EX',
        OTP_RESEND_COOLDOWN_SECONDS,
        'NX',
      );
    });

    it('cannot be claimed while it runs', async () => {
      redis.set.mockResolvedValue(null);
      await expect(service.tryStartCooldown('u-1')).resolves.toBe(false);
    });

    it('can be cleared', async () => {
      await service.clearCooldown('u-1');
      expect(redis.del).toHaveBeenCalledWith(COOLDOWN_KEY);
    });
  });
});
