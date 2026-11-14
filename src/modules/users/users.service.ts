import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UserDto } from './dto/user.dto.js';

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Already hashed by the caller: this service never sees a plain password. */
  passwordHash: string;
}

/**
 * Only the fields exposed by UserDto are read from the database; in
 * particular `passwordHash` is never selected here.
 */
const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function toUserDto(user: SelectedUser): UserDto {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts directly and relies on the unique indexes rather than checking
   * first: a check-then-insert would still race with a concurrent signup.
   */
  async create(input: CreateUserInput): Promise<UserDto> {
    try {
      const user = await this.prisma.user.create({
        // Prisma's generic `create` signature does not reject unknown fields in
        // `data`; `satisfies` does, so a schema/client mismatch fails to compile.
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          passwordHash: input.passwordHash,
        } satisfies Prisma.UserCreateInput,
        select: USER_SELECT,
      });
      this.logger.log(`User created: ${user.id}`);
      return toUserDto(user);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw await this.conflictFor(input);
      }
      throw err;
    }
  }

  /** Removes a user, e.g. to roll back a registration that could not finish. */
  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id }, select: { id: true } });
  }

  /**
   * With driver adapters, P2002 carries no portable `meta.target`, so the
   * conflicting field is found by looking the user up instead.
   */
  private async conflictFor({
    email,
    phone,
  }: CreateUserInput): Promise<ConflictException> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true, phone: true },
    });
    if (existing?.email === email) {
      return conflict('EMAIL_ALREADY_IN_USE', 'Email is already in use');
    }
    if (existing?.phone === phone) {
      return conflict('PHONE_ALREADY_IN_USE', 'Phone number is already in use');
    }
    return conflict('USER_ALREADY_EXISTS', 'User already exists');
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, code, message });
}
