import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../redis/cache.service.js';
import {
  ListProvincesQueryDto,
  ProvinceSortField,
  SortOrder,
} from './dto/list-provinces-query.dto.js';
import {
  PROVINCES_CACHE_NAMESPACE,
  ProvinceService,
} from './province.service.js';

describe('ProvinceService', () => {
  const prisma = {
    province: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  };
  const cache = {
    remember: vi.fn(
      (_ns: string, _key: unknown[], _ttl: number, load: () => unknown) =>
        load(),
    ),
    invalidate: vi.fn(),
  };
  const config = { get: vi.fn() };
  let service: ProvinceService;

  const query = (overrides: Partial<ListProvincesQueryDto> = {}) =>
    ({
      page: 1,
      limit: 20,
      sortBy: ProvinceSortField.Name,
      order: SortOrder.Asc,
      ...overrides,
    }) as ListProvincesQueryDto;

  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockReturnValue(undefined);
    service = new ProvinceService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheService,
      config as unknown as ConfigService,
    );
  });

  describe('create', () => {
    it('creates the province then invalidates the list cache', async () => {
      const province = { id: 'id-1', name: 'Kinshasa' };
      prisma.province.create.mockResolvedValue(province);

      await expect(service.create({ name: 'Kinshasa' })).resolves.toEqual(
        province,
      );
      expect(prisma.province.create).toHaveBeenCalledWith({
        data: { name: 'Kinshasa' },
        select: { id: true, name: true },
      });
      expect(PROVINCES_CACHE_NAMESPACE).toBe('brightpath:provinces:list');
      expect(cache.invalidate).toHaveBeenCalledWith(PROVINCES_CACHE_NAMESPACE);
    });
  });

  describe('findAll', () => {
    it('paginates, filters and sorts with a stable tie-breaker', async () => {
      prisma.province.count.mockResolvedValue(45);
      prisma.province.findMany.mockResolvedValue([{ id: 'a', name: 'Kasaï' }]);

      const result = await service.findAll(
        query({ page: 3, limit: 10, search: 'ka', order: SortOrder.Desc }),
      );

      const where = { name: { contains: 'ka', mode: 'insensitive' } };
      expect(prisma.province.count).toHaveBeenCalledWith({ where });
      expect(prisma.province.findMany).toHaveBeenCalledWith({
        where,
        orderBy: [{ name: 'desc' }, { id: 'desc' }],
        select: { id: true, name: true },
        skip: 20,
        take: 10,
      });
      expect(result).toEqual({
        data: [{ id: 'a', name: 'Kasaï' }],
        meta: {
          page: 3,
          limit: 10,
          total: 45,
          totalPages: 5,
          hasNextPage: true,
          hasPreviousPage: true,
        },
      });
    });

    it('escapes LIKE wildcards in the search term', async () => {
      prisma.province.count.mockResolvedValue(0);
      prisma.province.findMany.mockResolvedValue([]);

      await service.findAll(query({ search: '100%_a\\b' }));

      expect(prisma.province.count).toHaveBeenCalledWith({
        where: { name: { contains: '100\\%\\_a\\\\b', mode: 'insensitive' } },
      });
    });

    it('sorts by id alone when sortBy is id', async () => {
      prisma.province.count.mockResolvedValue(0);
      prisma.province.findMany.mockResolvedValue([]);

      const result = await service.findAll(
        query({ sortBy: ProvinceSortField.Id }),
      );

      expect(prisma.province.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, orderBy: [{ id: 'asc' }] }),
      );
      expect(result.meta).toMatchObject({
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('caches under a key covering every query parameter', async () => {
      config.get.mockReturnValue('120');
      service = new ProvinceService(
        prisma as unknown as PrismaService,
        cache as unknown as CacheService,
        config as unknown as ConfigService,
      );
      prisma.province.count.mockResolvedValue(0);
      prisma.province.findMany.mockResolvedValue([]);

      await service.findAll(
        query({ page: 2, limit: 5, search: 'KIN', order: SortOrder.Desc }),
      );

      expect(cache.remember).toHaveBeenCalledWith(
        PROVINCES_CACHE_NAMESPACE,
        [2, 5, 'name', 'desc', 'kin'],
        120,
        expect.any(Function),
      );
    });
  });
});
