import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailDeliveryError, EmailService } from './email.service.js';

describe('EmailService', () => {
  const resend = { emails: { send: vi.fn() } };
  const service = new EmailService(
    resend as unknown as Resend,
    'BrightPath <noreply@example.com>',
  );
  const input = {
    to: 'delivered@resend.dev',
    subject: 'Subject',
    html: '<p>Body</p>',
    text: 'Body',
    idempotencyKey: 'registration-otp/u-1',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('sends from the configured sender with the idempotency key and a timeout', async () => {
    resend.emails.send.mockResolvedValue({ data: { id: 'e-1' }, error: null });

    await expect(service.send(input)).resolves.toBe('e-1');
    expect(resend.emails.send).toHaveBeenCalledWith(
      {
        from: 'BrightPath <noreply@example.com>',
        to: ['delivered@resend.dev'],
        subject: 'Subject',
        html: '<p>Body</p>',
        text: 'Body',
      },
      {
        idempotencyKey: 'registration-otp/u-1',
        signal: expect.any(AbortSignal) as AbortSignal,
      },
    );
  });

  it('throws when Resend returns an error (the SDK does not throw)', async () => {
    resend.emails.send.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        statusCode: 403,
        message: 'delivered@resend.dev is not allowed',
      },
    });

    const err = await service.send(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect((err as EmailDeliveryError).reason).toBe('validation_error');
    // The recipient quoted in the API message never reaches the logs.
    expect(
      JSON.stringify(vi.mocked(Logger.prototype.warn).mock.calls),
    ).not.toContain('delivered@resend.dev');
  });

  it('throws when the request itself fails or times out', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError');
    resend.emails.send.mockRejectedValue(timeout);

    await expect(service.send(input)).rejects.toMatchObject({
      reason: 'TimeoutError',
    });
  });
});
