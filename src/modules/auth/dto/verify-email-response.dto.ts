import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../users/dto/user.dto.js';

export class VerifyEmailResponseDto {
  @ApiProperty({ example: 'Email verified successfully.' })
  message: string;

  @ApiProperty({ type: UserDto })
  data: UserDto;
}
