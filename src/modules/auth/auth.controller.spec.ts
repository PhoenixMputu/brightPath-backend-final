import {
  ConflictException,
  INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { AuthController, REGISTER_SUCCESS_MESSAGE } from './auth.controller.js';
import { AuthService } from './auth.service.js';

describe('AuthController', () => {
  let app: INestApplication;
  const authService = { register: vi.fn() };

  const profile = {
    firstName: 'Victory',
    lastName: 'Deo',
    email: 'victory.deo@example.com',
    phone: '+243812345678',
  };
  const valid = { ...profile, password: 'Str0ngPassword' };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterEach(() => app.close());

  const register = (body: object) =>
    request(app.getHttpServer()).post('/api/v1/auth/register').send(body);

  it('registers an inactive user and returns it with a message', async () => {
    const user = {
      id: '019a7d2e-4b1c-7a3f-9e2d-1c5b8a6f4e3d',
      ...profile,
      status: 'INACTIVE',
      createdAt: '2026-11-13T15:00:00.000Z',
    };
    authService.register.mockResolvedValue(user);

    await register(valid)
      .expect(201)
      .expect({ message: REGISTER_SUCCESS_MESSAGE, data: user });
  });

  it('normalizes the email, the names and the phone before registering', async () => {
    authService.register.mockResolvedValue({});

    await register({
      firstName: '  Victory ',
      lastName: ' Deo ',
      email: '  Victory.DEO@Example.com ',
      phone: '+243 (81) 234-56.78',
      password: 'Str0ngPassword',
    }).expect(201);

    expect(authService.register).toHaveBeenCalledWith(valid);
  });

  it('keeps the password exactly as submitted (no trimming)', async () => {
    authService.register.mockResolvedValue({});

    await register({ ...valid, password: ' Str0ngPassword ' }).expect(201);

    expect(authService.register).toHaveBeenCalledWith(
      expect.objectContaining({ password: ' Str0ngPassword ' }),
    );
  });

  it.each([
    ['missing firstName', { ...valid, firstName: undefined }],
    ['blank lastName', { ...valid, lastName: '   ' }],
    ['too long firstName', { ...valid, firstName: 'x'.repeat(101) }],
    ['invalid email', { ...valid, email: 'not-an-email' }],
    ['phone without country code', { ...valid, phone: '0812345678' }],
    ['phone with letters', { ...valid, phone: '+24381234ABCD' }],
    ['impossible phone number', { ...valid, phone: '+2431' }],
    ['unknown field', { ...valid, role: 'admin' }],
    ['missing password', { ...profile }],
    ['password too short', { ...valid, password: 'Ab1defg' }],
    ['password without uppercase', { ...valid, password: 'str0ngpassword' }],
    ['password without lowercase', { ...valid, password: 'STR0NGPASSWORD' }],
    ['password without digit', { ...valid, password: 'StrongPassword' }],
    ['password too long', { ...valid, password: 'Aa1' + 'x'.repeat(126) }],
    ['non-string password', { ...valid, password: 12345678 }],
  ])('rejects %s with 400', async (_label, body) => {
    await register(body).expect(400);
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('returns the 409 body produced by the service', async () => {
    const body = {
      statusCode: 409,
      code: 'EMAIL_ALREADY_IN_USE',
      message: 'Email is already in use',
    };
    authService.register.mockRejectedValue(new ConflictException(body));

    await register(valid).expect(409).expect(body);
  });

  it('returns 503 when the verification email cannot be sent', async () => {
    const body = {
      statusCode: 503,
      code: 'VERIFICATION_EMAIL_NOT_SENT',
      message: 'Verification email could not be sent, please try again',
    };
    authService.register.mockRejectedValue(
      new ServiceUnavailableException(body),
    );

    await register(valid).expect(503).expect(body);
  });
});
