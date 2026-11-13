import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination.dto.js';

export class ProvinceDto {
  @ApiProperty({
    format: 'uuid',
    example: '019a6a3c-8f2e-7c41-9b3a-2d4e5f6a7b8c',
  })
  id: string;

  @ApiProperty({ example: 'Kinshasa' })
  name: string;
}

export class CreateProvinceResponseDto {
  @ApiProperty({ example: 'Province created successfully.' })
  message: string;

  @ApiProperty({ type: ProvinceDto })
  data: ProvinceDto;
}

export class ProvincePageDto {
  @ApiProperty({ type: [ProvinceDto] })
  data: ProvinceDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

export class ListProvincesResponseDto extends ProvincePageDto {
  @ApiProperty({ example: 'Provinces retrieved successfully.' })
  message: string;
}
