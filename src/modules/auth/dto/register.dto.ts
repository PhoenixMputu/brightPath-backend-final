import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsPhoneNumber,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** E.164: "+", a non-zero country code digit, 8 to 15 digits in total. */
const E164 = /^\+[1-9]\d{7,14}$/;

export class RegisterDto {
  @ApiProperty({ example: 'Victory', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  readonly firstName: string;

  @ApiProperty({ example: 'Deo', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  readonly lastName: string;

  @ApiProperty({
    example: 'victory.deo@example.com',
    description: 'Trimmed and lowercased before being stored.',
    maxLength: 254,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  readonly email: string;

  @ApiProperty({
    example: '+243812345678',
    description:
      'International E.164 format. Spaces, dashes, dots and parentheses are removed.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s\-.()]/g, '') : value,
  )
  @Matches(E164, {
    message: 'phone must be in E.164 format, e.g. +243812345678',
  })
  @IsPhoneNumber(undefined, { message: 'phone must be a valid phone number' })
  readonly phone: string;
}
