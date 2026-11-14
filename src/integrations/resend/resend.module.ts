import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EmailService } from './email.service.js';
import { MAIL_FROM, RESEND_CLIENT } from './resend.constants.js';

@Module({
  providers: [
    {
      provide: RESEND_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Resend(config.getOrThrow<string>('RESEND_API_KEY')),
    },
    {
      provide: MAIL_FROM,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<string>('MAIL_FROM'),
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class ResendModule {}
