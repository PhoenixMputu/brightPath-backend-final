import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CreateProvinceDto } from './dto/create-province.dto.js';
import { ListProvincesQueryDto } from './dto/list-provinces-query.dto.js';
import {
  CreateProvinceResponseDto,
  ListProvincesResponseDto,
} from './dto/province-response.dto.js';
import { ProvinceService } from './province.service.js';

@ApiTags('provinces')
@Controller('provinces')
export class ProvinceController {
  constructor(private readonly provinceService: ProvinceService) {}

  @Post()
  @ApiOperation({ summary: 'Create a province' })
  @ApiCreatedResponse({ type: CreateProvinceResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  async create(
    @Body() dto: CreateProvinceDto,
  ): Promise<CreateProvinceResponseDto> {
    const province = await this.provinceService.create(dto);
    return { message: 'Province created successfully.', data: province };
  }

  @Get()
  @ApiOperation({
    summary: 'List provinces',
    description:
      'Paginated list with search and sorting. Results are cached in Redis and invalidated on every creation.',
  })
  @ApiOkResponse({ type: ListProvincesResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.' })
  async findAll(
    @Query() query: ListProvincesQueryDto,
  ): Promise<ListProvincesResponseDto> {
    const page = await this.provinceService.findAll(query);
    return { message: 'Provinces retrieved successfully.', ...page };
  }
}
