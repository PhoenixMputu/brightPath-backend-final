import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { UserStatus } from '../../generated/prisma/enums.js';
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
      this.logger.log({ userId: user.id }, 'User created');
      return toUserDto(user);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw await this.conflictFor(input);
      }
      throw err;
    }
  }

  async findByEmail(email: string): Promise<UserDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: USER_SELECT,
    });
    return user && toUserDto(user);
  }

  /** Throws 404 USER_NOT_FOUND, e.g. when the account was deleted. */
  async findById(id: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    return toUserDto(user);
  }

  /** False when the user does not exist or is not ACTIVE. */
  async isActive(id: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { status: true },
    });
    return user?.status === UserStatus.ACTIVE;
  }

  async activate(id: string): Promise<UserDto> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.ACTIVE } satisfies Prisma.UserUpdateInput,
      select: USER_SELECT,
    });
    this.logger.log({ userId: user.id }, 'User activated');
    return toUserDto(user);
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
