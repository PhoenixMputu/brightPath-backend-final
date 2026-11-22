import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UserStatus } from '../../generated/prisma/enums.js';
import { errorSummary } from '../../common/utils/error-summary.js';
import { EmailService } from '../../integrations/resend/email.service.js';
import { UserDto } from '../users/dto/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResendVerificationCodeDto } from './dto/resend-verification-code.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { refreshTokenInvalid } from './refresh-token-invalid.js';
import type { RefreshSession } from './strategies/jwt-refresh.strategy.js';
import { type AuthTokens, TokenService } from './token.service.js';
import { verificationEmail } from './verification-email.js';

/** A user signed in by a new session. */
export interface AuthenticatedUser {
  user: UserDto;
  tokens: AuthTokens;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * Creates the user as INACTIVE, then emails a verification code.
   *
   * If the code cannot be stored or sent, the user is deleted again: otherwise
   * the account would exist without any code and every retry would get a 409.
   */
  async register(dto: RegisterDto): Promise<UserDto> {
    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.usersService.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      phone: dto.phone,
      passwordHash,
    });

    try {
      await this.sendCode(user, `registration-otp/${user.id}`);
    } catch (err) {
      await this.rollBack(user.id, err);
      throw emailNotSent();
    }
    return user;
  }

  /**
   * Sends a new code, replacing the previous one, at most once per cooldown.
   *
   * Unknown and already verified emails get the same silent success as a real
   * send, so the endpoint does not reveal which accounts exist.
   */
  async resendVerificationCode(dto: ResendVerificationCodeDto): Promise<void> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || user.status !== UserStatus.INACTIVE) return;

    // A locked user cannot use a new code anyway: do not email one.
    if (await this.otpService.isLocked(user.id)) throw verificationLocked();

    if (!(await this.otpService.tryStartCooldown(user.id))) {
      throw new HttpException(
        {
          statusCode: 429,
          code: 'OTP_RESEND_TOO_SOON',
          message: 'A code was sent recently, please wait before asking again',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!(await this.otpService.tryCountResend(user.id))) {
      throw new HttpException(
        {
          statusCode: 429,
          code: 'OTP_RESEND_LIMIT_REACHED',
          message: 'Too many codes requested, please try again later',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      // Each resend is a distinct email: reusing a key with a new code would
      // make Resend answer 409.
      await this.sendCode(user, `resend-otp/${user.id}/${randomUUID()}`);
    } catch (err) {
      this.logger.warn(
        { err: errorSummary(err), userId: user.id },
        'Verification code resend failed',
      );
      // The previous code may already be replaced: let the user retry now.
      await this.otpService.clearCooldown(user.id).catch(() => undefined);
      throw emailNotSent();
    }
  }

  /**
   * Activates the account when the code matches and signs the user in with a
   * new session. An unknown email gets the same answer as a wrong code.
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<AuthenticatedUser> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw invalidCode();
    if (user.status === UserStatus.ACTIVE) {
      throw new ConflictException({
        statusCode: 409,
        code: 'EMAIL_ALREADY_VERIFIED',
        message: 'Email is already verified',
      });
    }

    const check = await this.otpService.verify(user.id, dto.code);
    switch (check) {
      case 'valid':
        return this.activateAndSignIn(user.id);
      case 'invalid':
        throw invalidCode();
      case 'expired':
        throw new BadRequestException({
          statusCode: 400,
          code: 'OTP_EXPIRED',
          message: 'Verification code has expired, request a new one',
        });
      case 'too_many_attempts':
        throw new HttpException(
          {
            statusCode: 429,
            code: 'OTP_TOO_MANY_ATTEMPTS',
            message: 'Too many attempts, request a new code',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'locked':
        throw verificationLocked();
    }
  }

  /**
   * Swaps a verified refresh token for a new pair in the same session.
   *
   * Refused with 401 REFRESH_TOKEN_INVALID when the account is no longer
   * active (the session is revoked), when the session is gone, or when the
   * token was already rotated: that reuse means it was stolen or replayed,
   * so the whole session is revoked and must sign in again.
   */
  async refresh(session: RefreshSession): Promise<AuthTokens> {
    const { userId, sessionId, refreshToken } = session;

    if (!(await this.usersService.isActive(userId))) {
      await this.tokenService.revoke(sessionId);
      this.logger.warn(
        { userId, sessionId },
        'Refresh refused, account not active',
      );
      throw refreshTokenInvalid();
    }

    const result = await this.tokenService.rotate(
      userId,
      sessionId,
      refreshToken,
    );
    switch (result.status) {
      case 'rotated':
        this.logger.log({ userId, sessionId }, 'Session refreshed');
        return result.tokens;
      case 'reused':
        this.logger.warn(
          { userId, sessionId },
          'Refresh token reuse detected, session revoked',
        );
        throw refreshTokenInvalid();
      case 'unknown':
        // Normal after a logout, an expiry or a reuse revocation.
        this.logger.debug(
          { userId, sessionId },
          'Refresh refused, session unknown',
        );
        throw refreshTokenInvalid();
    }
  }

  /**
   * Opens the session before activating: if Redis fails, the account stays
   * INACTIVE and the user can ask for a new code, instead of being active
   * with no session and no way to sign in yet. If the activation fails, the
   * session is revoked so no valid refresh token outlives it.
   */
  private async activateAndSignIn(userId: string): Promise<AuthenticatedUser> {
    let tokens: AuthTokens;
    try {
      tokens = await this.tokenService.issue(userId);
    } catch (err) {
      this.logger.warn(
        { err: errorSummary(err), userId },
        'Session could not be opened',
      );
      // The code is already consumed: tell the client to ask for a new one.
      throw sessionNotOpened();
    }

    try {
      const user = await this.usersService.activate(userId);
      this.logger.log(
        { userId, sessionId: tokens.sessionId },
        'Session opened after email verification',
      );
      return { user, tokens };
    } catch (err) {
      await this.tokenService.revoke(tokens.sessionId).catch((revokeErr) => {
        this.logger.error(
          { err: errorSummary(revokeErr), userId, sessionId: tokens.sessionId },
          'Session revoke failed, orphan session left until it expires',
        );
      });
      throw err;
    }
  }

  private async sendCode(user: UserDto, idempotencyKey: string): Promise<void> {
    const code = await this.otpService.issue(user.id);
    await this.emailService.send({
      to: user.email,
      ...verificationEmail(user.firstName, code),
      idempotencyKey,
    });
    this.logger.log({ userId: user.id }, 'Verification code sent');
  }

  private async rollBack(userId: string, cause: unknown): Promise<void> {
    this.logger.warn(
      { err: errorSummary(cause), userId },
      'Registration rolled back',
    );
    await this.otpService.revoke(userId).catch(() => undefined);
    await this.usersService.delete(userId).catch((err: unknown) => {
      this.logger.error(
        { err: errorSummary(err), userId },
        'Registration rollback failed, inactive user left without a code',
      );
    });
  }
}

function invalidCode(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'OTP_INVALID',
    message: 'Verification code is invalid',
  });
}

function verificationLocked(): HttpException {
  return new HttpException(
    {
      statusCode: 429,
      code: 'OTP_VERIFICATION_LOCKED',
      message: 'Too many failed attempts, please try again later',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

function sessionNotOpened(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'SESSION_NOT_OPENED',
    message: 'Could not sign you in, please request a new verification code',
  });
}

function emailNotSent(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'VERIFICATION_EMAIL_NOT_SENT',
    message: 'Verification email could not be sent, please try again',
  });
}
