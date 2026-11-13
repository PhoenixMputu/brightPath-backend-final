import { ApiProperty } from '@nestjs/swagger';

export class UserDto {
  @ApiProperty({
    format: 'uuid',
    example: '019a7d2e-4b1c-7a3f-9e2d-1c5b8a6f4e3d',
  })
  id: string;

  @ApiProperty({ example: 'Victory' })
  firstName: string;

  @ApiProperty({ example: 'Deo' })
  lastName: string;

  @ApiProperty({ example: 'victory.deo@example.com' })
  email: string;

  @ApiProperty({ example: '+243812345678' })
  phone: string;

  @ApiProperty({ example: '2026-11-13T15:16:47.000Z' })
  createdAt: Date;
}
