import { ApiProperty } from '@nestjs/swagger';

/** The province a user lives in, as embedded in UserDto. */
export class UserProvinceDto {
  @ApiProperty({
    format: 'uuid',
    example: '019a6b1c-2d3e-7f40-8a51-6b7c8d9e0f12',
  })
  id: string;

  @ApiProperty({ example: 'Haut-Katanga' })
  name: string;
}
