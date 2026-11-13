import { ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

describe('UsersService', () => {
  const prisma = { user: { create: vi.fn(), findFirst: vi.fn() } };
  let service: UsersService;

  const input = {
    firstName: 'Victory',
    lastName: 'Deo',
    email: 'victory.deo@example.com',
    phone: '+243812345678',
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

  it('creates the user and returns only the public fields', async () => {
    const createdAt = new Date('2026-11-13T15:00:00Z');
    prisma.user.create.mockResolvedValue({ id: 'u-1', ...input, createdAt });

    await expect(service.create(input)).resolves.toEqual({
      id: 'u-1',
      ...input,
      createdAt,
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: input,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
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
});
