import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';

describe('AuthService', () => {
  const usersService = { create: vi.fn() };
  const passwordService = { hash: vi.fn(), verify: vi.fn() };
  const service = new AuthService(
    usersService as unknown as UsersService,
    passwordService as unknown as PasswordService,
  );

  const profile = {
    firstName: 'Victory',
    lastName: 'Deo',
    email: 'victory.deo@example.com',
    phone: '+243812345678',
  };

  beforeEach(() => vi.resetAllMocks());

  it('hashes the password and never passes it in plain text', async () => {
    const user = { id: 'u-1', ...profile, createdAt: new Date() };
    passwordService.hash.mockResolvedValue('$argon2id$hash');
    usersService.create.mockResolvedValue(user);

    await expect(
      service.register({ ...profile, password: 'Str0ngPassword' }),
    ).resolves.toBe(user);

    expect(passwordService.hash).toHaveBeenCalledWith('Str0ngPassword');
    expect(usersService.create).toHaveBeenCalledWith({
      ...profile,
      passwordHash: '$argon2id$hash',
    });
    expect(JSON.stringify(usersService.create.mock.calls)).not.toContain(
      'Str0ngPassword',
    );
  });

  it('does not create the user when hashing fails', async () => {
    passwordService.hash.mockRejectedValue(new Error('out of memory'));

    await expect(
      service.register({ ...profile, password: 'Str0ngPassword' }),
    ).rejects.toThrow('out of memory');
    expect(usersService.create).not.toHaveBeenCalled();
  });
});
