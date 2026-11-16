import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '../../config/env.schema.js';
import { EmailService } from './email.service.js';
import { MAIL_FROM, RESEND_CLIENT } from './resend.constants.js';

@Module({
  providers: [
    {
      provide: RESEND_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Resend(config.get('RESEND_API_KEY', { infer: true })),
    },
    {
      provide: MAIL_FROM,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('MAIL_FROM', { infer: true }),
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class ResendModule {}
