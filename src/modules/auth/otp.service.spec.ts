import { Redis } from 'ioredis';
import { OTP_TTL_SECONDS, OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';

describe('OtpService', () => {
  const redis = { set: vi.fn(), del: vi.fn() };
  const passwordService = new PasswordService();
  const service = new OtpService(redis as unknown as Redis, passwordService);

  beforeEach(() => vi.resetAllMocks());

  it('returns a 6-digit code and stores only its hash, with a TTL', async () => {
    const code = await service.issue('u-1');

    expect(code).toMatch(/^\d{6}$/);
    expect(redis.set).toHaveBeenCalledWith(
      'brightpath:auth:otp:u-1',
      expect.stringMatching(/^\$argon2id\$/),
      'EX',
      OTP_TTL_SECONDS,
    );
    const stored = redis.set.mock.calls[0][1] as string;
    expect(stored).not.toContain(code);
    await expect(passwordService.verify(stored, code)).resolves.toBe(true);
  });

  it('generates a different code each time', async () => {
    const codes = new Set(
      await Promise.all(Array.from({ length: 5 }, () => service.issue('u-1'))),
    );
    expect(codes.size).toBeGreaterThan(1);
  });

  it('fails when Redis cannot store the code', async () => {
    redis.set.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.issue('u-1')).rejects.toThrow('ECONNREFUSED');
  });

  it('revokes a code by deleting its key', async () => {
    await service.revoke('u-1');
    expect(redis.del).toHaveBeenCalledWith('brightpath:auth:otp:u-1');
  });
});
