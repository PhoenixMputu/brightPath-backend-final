import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import {
  EmailDeliveryError,
  EmailRecipientRejectedError,
  EmailService,
} from './email.service.js';

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
    // A sandbox restriction is configuration, not a bad address.
    expect(err).not.toBeInstanceOf(EmailRecipientRejectedError);
    expect((err as EmailDeliveryError).reason).toBe('validation_error');
    // The recipient quoted in the API message never reaches the logs.
    expect(
      JSON.stringify(vi.mocked(Logger.prototype.warn).mock.calls),
    ).not.toContain('delivered@resend.dev');
  });

  it('reports a refused recipient address apart from other errors', async () => {
    // The exact answer Resend gave for an example.com recipient. If Resend
    // rewords it, detection falls back to a plain delivery error (a 503).
    resend.emails.send.mockResolvedValue({
      data: null,
      error: {
        name: 'validation_error',
        statusCode: 422,
        message:
          'Invalid `to` field. Please use our testing email address instead of domains like `example.com`. See our documentation for more information. victory.deo@example.com',
      },
    });

    const err = await service.send(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailRecipientRejectedError);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      { reason: 'validation_error', statusCode: 422, recipientRejected: true },
      'Resend rejected the email',
    );
    // The API message is read, never logged: it may quote the recipient.
    expect(
      JSON.stringify(vi.mocked(Logger.prototype.warn).mock.calls),
    ).not.toContain('example.com');
  });

  it.each([
    ['another 422', 'validation_error', 422, 'Invalid `from` field.'],
    ['a 403', 'validation_error', 403, 'You can only send to `to` yourself'],
    ['a missing status', 'validation_error', null, 'Invalid `to` field.'],
    [
      'another error name',
      'missing_required_field',
      422,
      'Missing `to` field.',
    ],
  ])(
    'keeps %s a plain delivery error',
    async (_label, name, statusCode, message) => {
      resend.emails.send.mockResolvedValue({
        data: null,
        error: { name, statusCode, message },
      });

      const err = await service.send(input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmailDeliveryError);
      expect(err).not.toBeInstanceOf(EmailRecipientRejectedError);
    },
  );

  it('throws when the request itself fails or times out', async () => {
    const timeout = new DOMException('timed out', 'TimeoutError');
    resend.emails.send.mockRejectedValue(timeout);

    await expect(service.send(input)).rejects.toMatchObject({
      reason: 'TimeoutError',
    });
  });
});
