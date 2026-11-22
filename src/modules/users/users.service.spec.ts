import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  const prisma = {
    user: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  let service: UsersService;

  const profile = {
    firstName: 'Victory',
    lastName: 'Deo',
    email: 'victory.deo@example.com',
    phone: '+243812345678',
  };
  const province = {
    id: '019a6b1c-2d3e-7f40-8a51-6b7c8d9e0f12',
    name: 'Haut-Katanga',
  };
  const city = 'Lubumbashi';
  const input = {
    ...profile,
    provinceId: province.id,
    city,
    passwordHash: '$argon2id$hash',
  };
  /** What USER_SELECT reads: the province comes as a relation. */
  const SELECT = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    city: true,
    province: { select: { id: true, name: true } },
    status: true,
    createdAt: true,
  };

  const uniqueViolation = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  const conflictBody = async (promise: Promise<unknown>) => {
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    return (err as ConflictException).getResponse();
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('creates the user and never returns the password hash', async () => {
    const createdAt = new Date('2026-11-13T15:00:00Z');
    // Even if the client returned the hash, it must not reach the DTO.
    prisma.user.create.mockResolvedValue({
      id: 'u-1',
      ...input,
      province,
      status: 'INACTIVE',
      createdAt,
    });

    const user = await service.create(input);

    expect(user).toEqual({
      id: 'u-1',
      ...profile,
      province,
      city,
      status: 'INACTIVE',
      createdAt,
    });
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('provinceId');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: input,
      select: SELECT,
    });
  });

  it('maps a duplicate email to EMAIL_ALREADY_IN_USE', async () => {
    prisma.user.create.mockRejectedValue(uniqueViolation());
    prisma.user.findFirst.mockResolvedValue({
      email: input.email,
      phone: '+243899999999',
    });

    await expect(conflictBody(service.create(input))).resolves.toEqual({
      statusCode: 409,
      code: 'EMAIL_ALREADY_IN_USE',
      message: 'Email is already in use',
    });
  });

  it('maps a duplicate phone to PHONE_ALREADY_IN_USE', async () => {
    prisma.user.create.mockRejectedValue(uniqueViolation());
    prisma.user.findFirst.mockResolvedValue({
      email: 'someone.else@example.com',
      phone: input.phone,
    });

    await expect(conflictBody(service.create(input))).resolves.toMatchObject({
      code: 'PHONE_ALREADY_IN_USE',
    });
  });

  it('falls back to USER_ALREADY_EXISTS when the conflicting row is gone', async () => {
    prisma.user.create.mockRejectedValue(uniqueViolation());
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(conflictBody(service.create(input))).resolves.toMatchObject({
      code: 'USER_ALREADY_EXISTS',
    });
  });

  /** A P2003 shaped like the pg driver adapter's (seen on the real database). */
  const foreignKeyViolation = (constraint: string) =>
    new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint violated',
      {
        code: 'P2003',
        clientVersion: 'test',
        meta: {
          modelName: 'User',
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              originalCode: '23503',
              kind: 'ForeignKeyConstraintViolation',
              constraint: { index: constraint },
            },
          },
        },
      },
    );

  it('rethrows a foreign key violation on another constraint untouched', async () => {
    const error = foreignKeyViolation('users_other_id_fkey');
    prisma.user.create.mockRejectedValue(error);

    await expect(service.create(input)).rejects.toBe(error);
  });

  it('answers 400 PROVINCE_NOT_FOUND when the province does not exist', async () => {
    prisma.user.create.mockRejectedValue(
      foreignKeyViolation('users_province_id_fkey'),
    );

    const err = await service.create(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      code: 'PROVINCE_NOT_FOUND',
      message: 'Province not found',
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rethrows any other database error untouched', async () => {
    const error = new Error('connection lost');
    prisma.user.create.mockRejectedValue(error);

    await expect(service.create(input)).rejects.toBe(error);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('deletes a user by id', async () => {
    await service.delete('u-1');
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      select: { id: true },
    });
  });

  it('finds a user by email without the password hash', async () => {
    const createdAt = new Date();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      ...input,
      province,
      status: 'INACTIVE',
      createdAt,
    });

    const user = await service.findByEmail(profile.email);

    expect(user).toEqual({
      id: 'u-1',
      ...profile,
      province,
      city,
      status: 'INACTIVE',
      createdAt,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: profile.email },
      select: SELECT,
    });
  });

  it('returns null for an unknown email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findByEmail('nobody@example.com')).resolves.toBeNull();
  });

  it('finds a user by id without the password hash', async () => {
    const createdAt = new Date();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-1',
      ...profile,
      city,
      province,
      status: 'ACTIVE',
      createdAt,
    });

    await expect(service.findById('u-1')).resolves.toEqual({
      id: 'u-1',
      ...profile,
      province,
      city,
      status: 'ACTIVE',
      createdAt,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      select: SELECT,
    });
  });

  it('answers 404 USER_NOT_FOUND for an unknown id', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const err = await service.findById('u-404').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toEqual({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
  });

  it('activates a user', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'u-1',
      ...profile,
      city,
      province,
      status: 'ACTIVE',
      createdAt: new Date(),
    });

    await expect(service.activate('u-1')).resolves.toMatchObject({
      status: 'ACTIVE',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { status: 'ACTIVE' },
      select: SELECT,
    });
  });

  it.each([
    ['an active user', { status: 'ACTIVE' }, true],
    ['an inactive user', { status: 'INACTIVE' }, false],
    ['an unknown user', null, false],
  ])('tells whether %s is active', async (_label, row, expected) => {
    prisma.user.findUnique.mockResolvedValue(row);

    await expect(service.isActive('u-1')).resolves.toBe(expected);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      select: { status: true },
    });
  });
});
