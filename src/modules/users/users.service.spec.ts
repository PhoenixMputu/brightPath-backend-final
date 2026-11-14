import { ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  const prisma = {
    user: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  };
  let service: UsersService;

  const profile = {
    firstName: 'Victory',
    lastName: 'Deo',
    email: 'victory.deo@example.com',
    phone: '+243812345678',
  };
  const input = { ...profile, passwordHash: '$argon2id$hash' };

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
      status: 'INACTIVE',
      createdAt,
    });

    const user = await service.create(input);

    expect(user).toEqual({
      id: 'u-1',
      ...profile,
      status: 'INACTIVE',
      createdAt,
    });
    expect(user).not.toHaveProperty('passwordHash');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: input,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
      },
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
});
