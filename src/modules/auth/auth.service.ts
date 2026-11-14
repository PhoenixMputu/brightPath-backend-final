import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EmailService } from '../../integrations/resend/email.service.js';
import { UserDto } from '../users/dto/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { RegisterDto } from './dto/register.dto.js';
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
      const code = await this.otpService.issue(user.id);
      await this.emailService.send({
        to: user.email,
        ...verificationEmail(user.firstName, code),
        idempotencyKey: `registration-otp/${user.id}`,
      });
    } catch (err) {
      await this.rollBack(user.id, err);
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'VERIFICATION_EMAIL_NOT_SENT',
        message: 'Verification email could not be sent, please try again',
      });
    }

    this.logger.log(`Verification code sent: ${user.id}`);
    return user;
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
