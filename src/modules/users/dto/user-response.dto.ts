import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from './user.dto.js';

export class UserResponseDto {
  @ApiProperty({ example: 'User retrieved successfully.' })
  message: string;

  @ApiProperty({ type: UserDto })
  data: UserDto;
}
