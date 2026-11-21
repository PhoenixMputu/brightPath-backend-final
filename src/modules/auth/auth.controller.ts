import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseInterceptors,
} from '@nestjs/common';
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
import { Throttle } from '@nestjs/throttler';
import { SENSITIVE_THROTTLE } from '../../common/throttle.js';
import {
  DEFAULT_ACCESS_TTL_SECONDS,
  DEFAULT_REFRESH_TTL_SECONDS,
} from '../../config/env.schema.js';
import {
  ACCESS_TOKEN_COOKIE,
  AuthCookiesResult,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
} from './auth-cookies.js';
import { AuthCookiesInterceptor } from './auth-cookies.interceptor.js';
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
@Throttle({ default: SENSITIVE_THROTTLE })
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
  @UseInterceptors(AuthCookiesInterceptor)
  @ApiOperation({
    summary: 'Verify the email with the code sent at registration',
    description:
      'Activates the account and signs the user in: the tokens are set as httpOnly cookies, never returned in the body. A code allows 5 attempts and is single-use. A user gets at most 15 attempts per 24 hours across all codes.',
  })
  @ApiOkResponse({
    type: VerifyEmailResponseDto,
    headers: {
      'Set-Cookie': {
        description: `\`${ACCESS_TOKEN_COOKIE}\` (path /, ${DEFAULT_ACCESS_TTL_SECONDS} s by default) and \`${REFRESH_TOKEN_COOKIE}\` (path ${REFRESH_TOKEN_COOKIE_PATH}, ${DEFAULT_REFRESH_TTL_SECONDS} s by default). Both HttpOnly, Secure, SameSite=Strict.`,
        schema: { type: 'string' },
      },
      'Cache-Control': {
        description: 'Always `no-store`: the response carries credentials.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description:
      'The code was right but the session could not be opened; the account stays inactive and a new code must be requested. `code` is SESSION_NOT_OPENED.',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid body, or `code` is OTP_INVALID (wrong code or unknown email) or OTP_EXPIRED.',
  })
  @ApiConflictResponse({
    description: 'Already verified. `code` is EMAIL_ALREADY_VERIFIED.',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Too many wrong codes; the code is revoked. `code` is OTP_TOO_MANY_ATTEMPTS (5 attempts on this code, request a new one) or OTP_VERIFICATION_LOCKED (15 attempts in 24 hours, wait).',
  })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
  ): Promise<AuthCookiesResult<VerifyEmailResponseDto>> {
    const { user, tokens } = await this.authService.verifyEmail(dto);
    return new AuthCookiesResult(
      { message: VERIFY_EMAIL_SUCCESS_MESSAGE, data: user },
      tokens,
    );
  }

  @Post('resend-verification-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a new verification code',
    description:
      'Replaces the current code and resets its 5 attempts (not the daily limit of 15). At most one code per minute and 5 per hour. Answers the same way for unknown or already verified emails.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiTooManyRequestsResponse({
    description:
      '`code` is OTP_RESEND_TOO_SOON (a code was sent less than a minute ago), OTP_RESEND_LIMIT_REACHED (5 codes in the last hour) or OTP_VERIFICATION_LOCKED (15 failed attempts in 24 hours).',
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
