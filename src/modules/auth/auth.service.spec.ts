import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  EmailDeliveryError,
  EmailService,
} from '../../integrations/resend/email.service.js';
import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';

describe('AuthService', () => {
  const usersService = { create: vi.fn(), delete: vi.fn() };
  const passwordService = { hash: vi.fn(), verify: vi.fn() };
  const otpService = { issue: vi.fn(), revoke: vi.fn() };
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
});
