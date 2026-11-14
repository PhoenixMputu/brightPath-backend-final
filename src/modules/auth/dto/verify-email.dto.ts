import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { OTP_LENGTH } from '../otp.service.js';
import { normalizeEmail } from './register.dto.js';

/** Exactly OTP_LENGTH digits. String.raw keeps `\d` (a template would drop the backslash). */
const OTP_PATTERN = String.raw`^\d{${OTP_LENGTH}}$`;

export class VerifyEmailDto {
  @ApiProperty({
    example: 'victory.deo@example.com',
    description: 'The email used at registration. Trimmed and lowercased.',
    maxLength: 254,
  })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  readonly email: string;

  @ApiProperty({
    example: '042137',
    description: `The ${OTP_LENGTH}-digit code received by email.`,
    pattern: OTP_PATTERN,
  })
  @IsString()
  @Matches(new RegExp(OTP_PATTERN), {
    message: `code must be a ${OTP_LENGTH}-digit string`,
  })
  readonly code: string;
}
