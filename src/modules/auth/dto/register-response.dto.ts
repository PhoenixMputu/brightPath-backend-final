import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../users/dto/user.dto.js';

export class RegisterResponseDto {
  @ApiProperty({
    example:
      'User registered successfully. A verification code has been sent by email.',
  })
  message: string;

  @ApiProperty({ type: UserDto })
  data: UserDto;
}
