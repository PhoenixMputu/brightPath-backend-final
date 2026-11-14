import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { normalizeEmail } from './register.dto.js';

export class ResendVerificationCodeDto {
  @ApiProperty({
    example: 'victory.deo@example.com',
    description: 'The email used at registration. Trimmed and lowercased.',
    maxLength: 254,
  })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  readonly email: string;
}
