import { Module } from '@nestjs/common';
import { ResendModule } from '../../integrations/resend/resend.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';

@Module({
  imports: [UsersModule, ResendModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, OtpService],
})
export class AuthModule {}
