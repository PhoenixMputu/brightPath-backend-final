import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterResponseDto } from './dto/register-response.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiConflictResponse({
    description:
      'Email or phone already in use. `code` is EMAIL_ALREADY_IN_USE, PHONE_ALREADY_IN_USE or USER_ALREADY_EXISTS.',
  })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    const user = await this.authService.register(dto);
    return { message: 'User registered successfully.', data: user };
  }
}
