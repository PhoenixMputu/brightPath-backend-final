import { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  const usersService = { create: vi.fn() };
  const service = new AuthService(usersService as unknown as UsersService);

  it('registers the user with exactly the submitted fields', async () => {
    const dto = {
      firstName: 'Victory',
      lastName: 'Deo',
      email: 'victory.deo@example.com',
      phone: '+243812345678',
    };
    const user = { id: 'u-1', ...dto, createdAt: new Date() };
    usersService.create.mockResolvedValue(user);

    await expect(service.register(dto)).resolves.toBe(user);
    expect(usersService.create).toHaveBeenCalledWith(dto);
  });
});
