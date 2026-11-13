import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

export enum ProvinceSortField {
  Name = 'name',
  /** UUID v7 ids are time-ordered, so this is creation order. */
  Id = 'id',
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}

export class ListProvincesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive search on the name.',
    example: 'kin',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(100)
  readonly search?: string;

  @ApiPropertyOptional({
    enum: ProvinceSortField,
    default: ProvinceSortField.Name,
    description: '`id` sorts by creation order (UUID v7).',
  })
  @IsEnum(ProvinceSortField)
  readonly sortBy: ProvinceSortField = ProvinceSortField.Name;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.Asc })
  @IsEnum(SortOrder)
  readonly order: SortOrder = SortOrder.Asc;
}
