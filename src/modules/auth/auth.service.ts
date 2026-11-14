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
import { EmailService } from '../../integrations/resend/email.service.js';
import { UserDto } from '../users/dto/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResendVerificationCodeDto } from './dto/resend-verification-code.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { verificationEmail } from './verification-email.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
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

    try {
      // Each resend is a distinct email: reusing a key with a new code would
      // make Resend answer 409.
      await this.sendCode(user, `resend-otp/${user.id}/${randomUUID()}`);
    } catch (err) {
      const reason = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(
        `Verification code resend failed (${reason}): ${user.id}`,
      );
      // The previous code may already be replaced: let the user retry now.
      await this.otpService.clearCooldown(user.id).catch(() => undefined);
      throw emailNotSent();
    }
  }

  /**
   * Activates the account when the code matches. An unknown email gets the
   * same answer as a wrong code.
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<UserDto> {
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
        return this.usersService.activate(user.id);
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
    }
  }

  private async sendCode(user: UserDto, idempotencyKey: string): Promise<void> {
    const code = await this.otpService.issue(user.id);
    await this.emailService.send({
      to: user.email,
      ...verificationEmail(user.firstName, code),
      idempotencyKey,
    });
    this.logger.log(`Verification code sent: ${user.id}`);
  }

  private async rollBack(userId: string, cause: unknown): Promise<void> {
    const reason = cause instanceof Error ? cause.name : 'unknown';
    this.logger.warn(`Registration rolled back (${reason}): ${userId}`);
    await this.otpService.revoke(userId).catch(() => undefined);
    await this.usersService.delete(userId).catch((err: unknown) => {
      this.logger.error(
        `Rollback failed, inactive user left without a code (${err instanceof Error ? err.name : 'unknown'}): ${userId}`,
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

function emailNotSent(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'VERIFICATION_EMAIL_NOT_SENT',
    message: 'Verification email could not be sent, please try again',
  });
}
