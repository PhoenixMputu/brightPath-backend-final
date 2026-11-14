import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterResponseDto } from './dto/register-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';

export const REGISTER_SUCCESS_MESSAGE =
  'User registered successfully. A verification code has been sent by email.';

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
}
