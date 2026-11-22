import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ResendModule } from '../../integrations/resend/resend.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthCookiesInterceptor } from './auth-cookies.interceptor.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard.js';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { TokenService } from './token.service.js';

@Module({
  // No default secret: TokenService passes the access or refresh secret on
  // every call, so a token can never be signed with the wrong one by default.
  imports: [
    UsersModule,
    ResendModule,
    JwtModule.register({}),
    // No sessions on the Passport side: the strategy is stateless.
    PassportModule.register({ session: false }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    OtpService,
    TokenService,
    AuthCookiesInterceptor,
    JwtStrategy,
    JwtRefreshStrategy,
    JwtRefreshGuard,
  ],
})
export class AuthModule {}
