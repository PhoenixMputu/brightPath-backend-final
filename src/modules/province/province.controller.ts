import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { ACCESS_TOKEN_COOKIE } from '../auth/auth-cookies.js';
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
  @ApiCookieAuth(ACCESS_TOKEN_COOKIE)
  @ApiOperation({ summary: 'Create a province (signed-in users only)' })
  @ApiCreatedResponse({ type: CreateProvinceResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiUnauthorizedResponse({
    description:
      'Not signed in. `code` is UNAUTHENTICATED, or ACCESS_TOKEN_EXPIRED when the access token must be refreshed.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded. `code` is TOO_MANY_REQUESTS.',
  })
  async create(
    @Body() dto: CreateProvinceDto,
  ): Promise<CreateProvinceResponseDto> {
    const province = await this.provinceService.create(dto);
    return { message: 'Province created successfully.', data: province };
  }

  @Public()
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
