import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../app.setup.js';
import { ProvinceController } from './province.controller.js';
import { ProvinceService } from './province.service.js';

describe('ProvinceController', () => {
  let app: INestApplication;
  const service = { create: vi.fn(), findAll: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [ProvinceController],
      providers: [{ provide: ProvinceService, useValue: service }],
    }).compile();

    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterEach(() => app.close());

  describe('POST /api/v1/provinces', () => {
    it('creates a province and returns it with a message', async () => {
      const province = {
        id: '019a6a3c-8f2e-7c41-9b3a-2d4e5f6a7b8c',
        name: 'Kinshasa',
      };
      service.create.mockResolvedValue(province);

      await request(app.getHttpServer())
        .post('/api/v1/provinces')
        .send({ name: 'Kinshasa' })
        .expect(201)
        .expect({ message: 'Province created successfully.', data: province });

      expect(service.create).toHaveBeenCalledWith({ name: 'Kinshasa' });
    });

    it.each([{}, { name: '' }, { name: 42 }, { name: 'Kinshasa', extra: 1 }])(
      'rejects invalid body %j with 400',
      async (body) => {
        await request(app.getHttpServer())
          .post('/api/v1/provinces')
          .send(body)
          .expect(400);
        expect(service.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('GET /api/v1/provinces', () => {
    const page = {
      data: [{ id: '019a6a3c-8f2e-7c41-9b3a-2d4e5f6a7b8c', name: 'Kinshasa' }],
      meta: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };

    it('applies defaults and returns the page with a message', async () => {
      service.findAll.mockResolvedValue(page);

      await request(app.getHttpServer())
        .get('/api/v1/provinces')
        .expect(200)
        .expect({ message: 'Provinces retrieved successfully.', ...page });

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          limit: 20,
          sortBy: 'name',
          order: 'asc',
          search: undefined,
        }),
      );
    });

    it('parses and trims query parameters', async () => {
      service.findAll.mockResolvedValue(page);

      await request(app.getHttpServer())
        .get('/api/v1/provinces')
        .query({
          page: '2',
          limit: '5',
          search: '  kin ',
          sortBy: 'id',
          order: 'desc',
        })
        .expect(200);

      expect(service.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          limit: 5,
          search: 'kin',
          sortBy: 'id',
          order: 'desc',
        }),
      );
    });

    it.each([
      { page: '0' },
      { page: 'abc' },
      { limit: '101' },
      { limit: '0' },
      { sortBy: 'password' },
      { order: 'up' },
      { search: 'x'.repeat(101) },
    ])('rejects invalid query %j with 400', async (query) => {
      await request(app.getHttpServer())
        .get('/api/v1/provinces')
        .query(query)
        .expect(400);
      expect(service.findAll).not.toHaveBeenCalled();
    });
  });
});
