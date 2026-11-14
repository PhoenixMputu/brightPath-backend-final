import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { MessageResponseDto } from './dto/message-response.dto.js';
import { RegisterResponseDto } from './dto/register-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResendVerificationCodeDto } from './dto/resend-verification-code.dto.js';
import { VerifyEmailResponseDto } from './dto/verify-email-response.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';

export const REGISTER_SUCCESS_MESSAGE =
  'User registered successfully. A verification code has been sent by email.';

export const VERIFY_EMAIL_SUCCESS_MESSAGE = 'Email verified successfully.';

export const RESEND_CODE_MESSAGE =
  'If this email belongs to an unverified account, a new code has been sent.';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates the user as INACTIVE and emails a 6-digit verification code, valid for 10 minutes.',
  })
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiConflictResponse({
    description:
      'Email or phone already in use. `code` is EMAIL_ALREADY_IN_USE, PHONE_ALREADY_IN_USE or USER_ALREADY_EXISTS.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'The verification email could not be sent; the user is not created. `code` is VERIFICATION_EMAIL_NOT_SENT.',
  })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    const user = await this.authService.register(dto);
    return { message: REGISTER_SUCCESS_MESSAGE, data: user };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify the email with the code sent at registration',
    description:
      'Activates the account. A code allows 5 attempts and is single-use.',
  })
  @ApiOkResponse({ type: VerifyEmailResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid body, or `code` is OTP_INVALID (wrong code or unknown email) or OTP_EXPIRED.',
  })
  @ApiConflictResponse({
    description: 'Already verified. `code` is EMAIL_ALREADY_VERIFIED.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Too many wrong codes; the code is revoked. `code` is OTP_TOO_MANY_ATTEMPTS.',
  })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
  ): Promise<VerifyEmailResponseDto> {
    const user = await this.authService.verifyEmail(dto);
    return { message: VERIFY_EMAIL_SUCCESS_MESSAGE, data: user };
  }

  @Post('resend-verification-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a new verification code',
    description:
      'Replaces the current code and resets its attempts. At most one code per minute. Answers the same way for unknown or already verified emails.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiTooManyRequestsResponse({
    description:
      'A code was sent less than a minute ago. `code` is OTP_RESEND_TOO_SOON.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'The email could not be sent; retry at once. `code` is VERIFICATION_EMAIL_NOT_SENT.',
  })
  async resendVerificationCode(
    @Body() dto: ResendVerificationCodeDto,
  ): Promise<MessageResponseDto> {
    await this.authService.resendVerificationCode(dto);
    return { message: RESEND_CODE_MESSAGE };
  }
}
