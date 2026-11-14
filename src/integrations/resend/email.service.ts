import { Inject, Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import {
  MAIL_FROM,
  RESEND_CLIENT,
  RESEND_TIMEOUT_MS,
} from './resend.constants.js';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * `<event-type>/<entity-id>`. Resend ignores a repeated key for 24 hours,
   * so a retried call never sends the same email twice.
   */
  idempotencyKey: string;
}

export class EmailDeliveryError extends Error {
  constructor(readonly reason: string) {
    super(`Email delivery failed: ${reason}`);
    this.name = 'EmailDeliveryError';
  }
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend,
    @Inject(MAIL_FROM) private readonly from: string,
  ) {}

  /** Resolves with the Resend email id, or throws EmailDeliveryError. */
  async send(input: SendEmailInput): Promise<string> {
    let result: Awaited<ReturnType<Resend['emails']['send']>>;
    try {
      result = await this.resend.emails.send(
        {
          from: this.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
        },
        {
          idempotencyKey: input.idempotencyKey,
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        },
      );
    } catch (err) {
      // The SDK reports API errors in `error`; a throw is a network failure
      // or the timeout.
      const reason = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(`Resend request failed (${reason})`);
      throw new EmailDeliveryError(reason);
    }

    if (result.error) {
      // Only the error name and status: the message may quote the recipient.
      this.logger.warn(
        `Resend rejected the email (${result.error.name}, ${result.error.statusCode ?? 'no status'})`,
      );
      throw new EmailDeliveryError(result.error.name);
    }
    return result.data.id;
  }
}
