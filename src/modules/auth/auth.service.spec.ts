import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EmailDeliveryError,
  EmailService,
} from '../../integrations/resend/email.service.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';

describe('AuthService', () => {
  const usersService = {
    create: vi.fn(),
    delete: vi.fn(),
    findByEmail: vi.fn(),
    activate: vi.fn(),
  };
  const passwordService = { hash: vi.fn(), verify: vi.fn() };
  const otpService = {
    issue: vi.fn(),
    revoke: vi.fn(),
    verify: vi.fn(),
    tryStartCooldown: vi.fn(),
    clearCooldown: vi.fn(),
  };
  const emailService = { send: vi.fn() };
  const service = new AuthService(
    usersService as unknown as UsersService,
    passwordService as unknown as PasswordService,
    otpService as unknown as OtpService,
    emailService as unknown as EmailService,
  );

  const profile = {
    firstName: 'Victory',
    lastName: 'Deo',
    email: 'victory.deo@example.com',
    phone: '+243812345678',
  };
  const dto = { ...profile, password: 'Str0ngPassword' };
  const user = {
    id: 'u-1',
    ...profile,
    status: 'INACTIVE' as const,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    passwordService.hash.mockResolvedValue('$argon2id$hash');
    usersService.create.mockResolvedValue(user);
    usersService.delete.mockResolvedValue(undefined);
    otpService.issue.mockResolvedValue('042137');
    otpService.revoke.mockResolvedValue(undefined);
    emailService.send.mockResolvedValue('email-1');
  });

  it('hashes the password and never passes it in plain text', async () => {
    await expect(service.register(dto)).resolves.toBe(user);

    expect(passwordService.hash).toHaveBeenCalledWith('Str0ngPassword');
    expect(usersService.create).toHaveBeenCalledWith({
      ...profile,
      passwordHash: '$argon2id$hash',
    });
    expect(JSON.stringify(usersService.create.mock.calls)).not.toContain(
      'Str0ngPassword',
    );
  });

  it('issues a code for the new user and emails it to them', async () => {
    await service.register(dto);

    expect(otpService.issue).toHaveBeenCalledWith('u-1');
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: profile.email,
        idempotencyKey: 'registration-otp/u-1',
        text: expect.stringContaining('042137') as string,
        html: expect.stringContaining('042137') as string,
      }),
    );
    expect(usersService.delete).not.toHaveBeenCalled();
  });

  it('does not create the user when hashing fails', async () => {
    passwordService.hash.mockRejectedValue(new Error('out of memory'));

    await expect(service.register(dto)).rejects.toThrow('out of memory');
    expect(usersService.create).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('sends nothing when the user cannot be created', async () => {
    usersService.create.mockRejectedValue(new Error('conflict'));

    await expect(service.register(dto)).rejects.toThrow('conflict');
    expect(otpService.issue).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  const unavailable = async () => {
    const err = await service.register(dto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    return (err as ServiceUnavailableException).getResponse();
  };

  it('deletes the user and its code when the email cannot be sent', async () => {
    emailService.send.mockRejectedValue(new EmailDeliveryError('TimeoutError'));

    await expect(unavailable()).resolves.toEqual({
      statusCode: 503,
      code: 'VERIFICATION_EMAIL_NOT_SENT',
      message: 'Verification email could not be sent, please try again',
    });
    expect(otpService.revoke).toHaveBeenCalledWith('u-1');
    expect(usersService.delete).toHaveBeenCalledWith('u-1');
  });

  it('deletes the user without emailing when the code cannot be stored', async () => {
    otpService.issue.mockRejectedValue(new Error('ECONNREFUSED'));

    await unavailable();
    expect(emailService.send).not.toHaveBeenCalled();
    expect(usersService.delete).toHaveBeenCalledWith('u-1');
  });

  it('still answers 503 when the rollback itself fails', async () => {
    emailService.send.mockRejectedValue(new EmailDeliveryError('x'));
    otpService.revoke.mockRejectedValue(new Error('ECONNREFUSED'));
    usersService.delete.mockRejectedValue(new Error('db down'));

    await unavailable();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  describe('verifyEmail', () => {
    const input = { email: profile.email, code: '042137' };

    const errorOf = async () => {
      const err = await service.verifyEmail(input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      return {
        status: (err as HttpException).getStatus(),
        body: (err as HttpException).getResponse(),
      };
    };

    beforeEach(() => usersService.findByEmail.mockResolvedValue(user));

    it('activates the user when the code is valid', async () => {
      const active = { ...user, status: 'ACTIVE' };
      otpService.verify.mockResolvedValue('valid');
      usersService.activate.mockResolvedValue(active);

      await expect(service.verifyEmail(input)).resolves.toBe(active);
      expect(usersService.findByEmail).toHaveBeenCalledWith(profile.email);
      expect(otpService.verify).toHaveBeenCalledWith('u-1', '042137');
      expect(usersService.activate).toHaveBeenCalledWith('u-1');
    });

    it('answers an unknown email exactly like a wrong code', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      const unknown = await errorOf();

      usersService.findByEmail.mockResolvedValue(user);
      otpService.verify.mockResolvedValue('invalid');
      const wrong = await errorOf();

      expect(unknown).toEqual(wrong);
      expect(wrong).toEqual({
        status: 400,
        body: {
          statusCode: 400,
          code: 'OTP_INVALID',
          message: 'Verification code is invalid',
        },
      });
      expect(usersService.activate).not.toHaveBeenCalled();
    });

    it('refuses an already verified user without touching the code', async () => {
      usersService.findByEmail.mockResolvedValue({ ...user, status: 'ACTIVE' });

      const err = await service.verifyEmail(input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        code: 'EMAIL_ALREADY_VERIFIED',
      });
      expect(otpService.verify).not.toHaveBeenCalled();
    });

    it('reports an expired code', async () => {
      otpService.verify.mockResolvedValue('expired');

      const { status, body } = await errorOf();
      expect(status).toBe(400);
      expect(body).toMatchObject({ code: 'OTP_EXPIRED' });
    });

    it('answers 429 after too many attempts', async () => {
      otpService.verify.mockResolvedValue('too_many_attempts');

      await expect(errorOf()).resolves.toEqual({
        status: 429,
        body: {
          statusCode: 429,
          code: 'OTP_TOO_MANY_ATTEMPTS',
          message: 'Too many attempts, request a new code',
        },
      });
      expect(usersService.activate).not.toHaveBeenCalled();
    });

    it('does not mistake other errors for a bad code', async () => {
      const failure = new Error('ECONNREFUSED');
      otpService.verify.mockRejectedValue(failure);

      const err = await service.verifyEmail(input).catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(BadRequestException);
      expect(err).toBe(failure);
    });
  });

  describe('resendVerificationCode', () => {
    const input = { email: profile.email };

    beforeEach(() => {
      usersService.findByEmail.mockResolvedValue(user);
      otpService.tryStartCooldown.mockResolvedValue(true);
      otpService.clearCooldown.mockResolvedValue(undefined);
    });

    it('issues a new code and emails it with a fresh idempotency key', async () => {
      await expect(
        service.resendVerificationCode(input),
      ).resolves.toBeUndefined();
      await service.resendVerificationCode(input);

      expect(usersService.findByEmail).toHaveBeenCalledWith(profile.email);
      expect(otpService.tryStartCooldown).toHaveBeenCalledWith('u-1');
      expect(otpService.issue).toHaveBeenCalledWith('u-1');
      const [first, second] = emailService.send.mock.calls.map(
        ([arg]) => arg as { to: string; idempotencyKey: string; text: string },
      );
      expect(first.to).toBe(profile.email);
      expect(first.text).toContain('042137');
      expect(first.idempotencyKey).toMatch(/^resend-otp\/u-1\/[0-9a-f-]{36}$/);
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    });

    it.each([
      ['an unknown email', null],
      ['an already verified user', { ...user, status: 'ACTIVE' }],
    ])('silently does nothing for %s', async (_label, found) => {
      usersService.findByEmail.mockResolvedValue(found);

      await expect(
        service.resendVerificationCode(input),
      ).resolves.toBeUndefined();
      expect(otpService.tryStartCooldown).not.toHaveBeenCalled();
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('answers 429 during the cooldown and keeps the current code', async () => {
      otpService.tryStartCooldown.mockResolvedValue(false);

      const err = await service
        .resendVerificationCode(input)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect((err as HttpException).getResponse()).toEqual({
        statusCode: 429,
        code: 'OTP_RESEND_TOO_SOON',
        message: 'A code was sent recently, please wait before asking again',
      });
      expect(otpService.issue).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('answers 503 and lifts the cooldown when the email cannot be sent', async () => {
      emailService.send.mockRejectedValue(
        new EmailDeliveryError('TimeoutError'),
      );

      const err = await service
        .resendVerificationCode(input)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
        code: 'VERIFICATION_EMAIL_NOT_SENT',
      });
      expect(otpService.clearCooldown).toHaveBeenCalledWith('u-1');
      // Unlike a failed registration, the account is kept.
      expect(usersService.delete).not.toHaveBeenCalled();
    });

    it('answers 503 when the new code cannot be stored', async () => {
      otpService.issue.mockRejectedValue(new Error('ECONNREFUSED'));

      const err = await service
        .resendVerificationCode(input)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(emailService.send).not.toHaveBeenCalled();
      expect(otpService.clearCooldown).toHaveBeenCalledWith('u-1');
    });
  });
});
