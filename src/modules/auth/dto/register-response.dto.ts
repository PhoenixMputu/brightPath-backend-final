import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../users/dto/user.dto.js';

export class RegisterResponseDto {
  @ApiProperty({ example: 'User registered successfully.' })
  message: string;

  @ApiProperty({ type: UserDto })
  data: UserDto;
}
