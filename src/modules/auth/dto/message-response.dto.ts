import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({
    example:
      'If this email belongs to an unverified account, a new code has been sent.',
  })
  message: string;
}
