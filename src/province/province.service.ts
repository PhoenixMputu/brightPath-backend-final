import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildPaginationMeta } from '../common/dto/pagination.dto.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../redis/cache.service.js';
import { redisKey } from '../redis/redis-keys.js';
import { CreateProvinceDto } from './dto/create-province.dto.js';
import {
  ListProvincesQueryDto,
  ProvinceSortField,
} from './dto/list-provinces-query.dto.js';
import { ProvinceDto, ProvincePageDto } from './dto/province-response.dto.js';

export const PROVINCES_CACHE_NAMESPACE = redisKey('provinces', 'list');
const DEFAULT_CACHE_TTL_SECONDS = 300;

/** Only the fields exposed by ProvinceDto are read from the database. */
const PROVINCE_SELECT = {
  id: true,
  name: true,
} satisfies Prisma.ProvinceSelect;

function toProvinceDto(province: ProvinceDto): ProvinceDto {
  return { id: province.id, name: province.name };
}

@Injectable()
export class ProvinceService {
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    this.cacheTtlSeconds =
      Number(config.get('PROVINCES_CACHE_TTL_SECONDS')) ||
      DEFAULT_CACHE_TTL_SECONDS;
  }

  async create(dto: CreateProvinceDto): Promise<ProvinceDto> {
    const province = await this.prisma.province.create({
      data: { name: dto.name },
      select: PROVINCE_SELECT,
    });
    await this.cache.invalidate(PROVINCES_CACHE_NAMESPACE);
    return toProvinceDto(province);
  }

  findAll(query: ListProvincesQueryDto): Promise<ProvincePageDto> {
    const { page, limit, search, sortBy, order } = query;
    return this.cache.remember(
      PROVINCES_CACHE_NAMESPACE,
      [page, limit, sortBy, order, search?.toLowerCase() ?? ''],
      this.cacheTtlSeconds,
      () => this.findPage(query),
    );
  }

  private async findPage({
    page,
    limit,
    search,
    sortBy,
    order,
  }: ListProvincesQueryDto): Promise<ProvincePageDto> {
    // Prisma passes `contains` to ILIKE as-is: escape the LIKE wildcards so
    // "%" or "_" are searched literally instead of matching everything.
    const where: Prisma.ProvinceWhereInput = search
      ? {
          name: {
            contains: search.replace(/[\\%_]/g, '\\$&'),
            mode: 'insensitive',
          },
        }
      : {};
    // `id` as tie-breaker keeps page boundaries stable between duplicate names.
    const orderBy: Prisma.ProvinceOrderByWithRelationInput[] =
      sortBy === ProvinceSortField.Id
        ? [{ id: order }]
        : [{ [sortBy]: order }, { id: order }];

    // Plain parallel reads, not $transaction: under READ COMMITTED a batch
    // transaction gives no shared snapshot anyway, and BEGIN/COMMIT adds round
    // trips plus a 2 s connection wait limit (P2028) on a remote database.
    const [total, data] = await Promise.all([
      this.prisma.province.count({ where }),
      this.prisma.province.findMany({
        where,
        orderBy,
        select: PROVINCE_SELECT,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map(toProvinceDto),
      meta: buildPaginationMeta(total, page, limit),
    };
  }
}
