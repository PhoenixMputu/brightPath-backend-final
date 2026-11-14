import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces a salted argon2id hash that verifies only the right password', async () => {
    const hash = await service.hash('Str0ngPassword');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('Str0ngPassword');
    await expect(service.verify(hash, 'Str0ngPassword')).resolves.toBe(true);
    await expect(service.verify(hash, 'str0ngPassword')).resolves.toBe(false);
  });

  it('salts every hash, so the same password gives different hashes', async () => {
    const [a, b] = await Promise.all([
      service.hash('Str0ngPassword'),
      service.hash('Str0ngPassword'),
    ]);
    expect(a).not.toBe(b);
  });
});
