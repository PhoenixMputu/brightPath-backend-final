import {
  BadRequestException,
  ConflictException,
  type ExecutionContext,
  HttpException,
  INestApplication,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import {
  AuthController,
  REFRESH_SUCCESS_MESSAGE,
  REGISTER_SUCCESS_MESSAGE,
  RESEND_CODE_MESSAGE,
  VERIFY_EMAIL_SUCCESS_MESSAGE,
} from './auth.controller.js';
import { AuthCookiesInterceptor } from './auth-cookies.interceptor.js';
import { AuthService } from './auth.service.js';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard.js';

describe('AuthController', () => {
  let app: INestApplication;
  const authService = {
    register: vi.fn(),
    verifyEmail: vi.fn(),
    resendVerificationCode: vi.fn(),
    refresh: vi.fn(),
  };
  const refreshSession = {
    userId: 'u-1',
    sessionId: 's-1',
    refreshToken: 'old.refresh.jwt',
  };
  /** Stands in for the refresh strategy, covered in jwt-refresh.guard.spec.ts. */
  const refreshGuard = {
    canActivate: (context: ExecutionContext) => {
      context.switchToHttp().getRequest<{ user: unknown }>().user =
        refreshSession;
      return true;
    },
  };

  const profile = {
    firstName: 'Victory',
    lastName: 'Deo',
    email: 'victory.deo@example.com',
    phone: '+243812345678',
  };
  const location = {
    provinceId: '019a6b1c-2d3e-7f40-8a51-6b7c8d9e0f12',
    city: 'Lubumbashi',
  };
  const valid = { ...profile, ...location, password: 'Str0ngPassword' };

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        AuthCookiesInterceptor,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    })
      .overrideGuard(JwtRefreshGuard)
      .useValue(refreshGuard)
      .compile();
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

  it('normalizes the email, the names, the phone and the city before registering', async () => {
    authService.register.mockResolvedValue({});

    await register({
      firstName: '  Victory ',
      lastName: ' Deo ',
      email: '  Victory.DEO@Example.com ',
      phone: '+243 (81) 234-56.78',
      provinceId: location.provinceId,
      city: '  Lubumbashi ',
      password: 'Str0ngPassword',
    }).expect(201);

    expect(authService.register).toHaveBeenCalledWith(valid);
  });

  it('accepts a city at the maximum length and an uppercase province id', async () => {
    authService.register.mockResolvedValue({});
    const body = {
      ...valid,
      provinceId: location.provinceId.toUpperCase(),
      city: 'x'.repeat(100),
    };

    await register(body).expect(201);
    expect(authService.register).toHaveBeenCalledWith(body);
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
    ['missing password', { ...profile, ...location }],
    ['missing provinceId', { ...valid, provinceId: undefined }],
    ['provinceId that is not a uuid', { ...valid, provinceId: 'kinshasa' }],
    ['missing city', { ...valid, city: undefined }],
    ['blank city', { ...valid, city: '   ' }],
    ['too long city', { ...valid, city: 'x'.repeat(101) }],
    ['non-string city', { ...valid, city: 42 }],
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

  describe('POST /auth/verify-email', () => {
    const verify = (body: object) =>
      request(app.getHttpServer()).post('/api/v1/auth/verify-email').send(body);
    const validBody = { email: profile.email, code: '042137' };

    const user = {
      id: '019a7d2e-4b1c-7a3f-9e2d-1c5b8a6f4e3d',
      ...profile,
      status: 'ACTIVE',
      createdAt: '2026-11-13T15:00:00.000Z',
    };
    const tokens = {
      sessionId: 's-1',
      accessToken: 'access.jwt.value',
      refreshToken: 'refresh.jwt.value',
      accessTtlSeconds: 900,
      refreshTtlSeconds: 604_800,
    };
    const signedIn = { user, tokens };

    /** Set-Cookie lines by cookie name. */
    const cookiesOf = (res: request.Response) =>
      Object.fromEntries(
        ([] as string[])
          .concat(res.headers['set-cookie'] ?? [])
          .map((line) => [line.split('=')[0], line]),
      );

    it('verifies the email and answers 200 with the active user', async () => {
      authService.verifyEmail.mockResolvedValue(signedIn);

      await verify(validBody)
        .expect(200)
        .expect({ message: VERIFY_EMAIL_SUCCESS_MESSAGE, data: user });
    });

    it('sets the access and refresh tokens as secure httpOnly cookies', async () => {
      authService.verifyEmail.mockResolvedValue(signedIn);

      const res = await verify(validBody).expect(200);
      const cookies = cookiesOf(res);

      expect(cookies.access_token).toMatch(
        /^access_token=access\.jwt\.value; Max-Age=900; Path=\/; Expires=[^;]+; HttpOnly; Secure; SameSite=Strict$/,
      );
      expect(cookies.refresh_token).toMatch(
        /^refresh_token=refresh\.jwt\.value; Max-Age=604800; Path=\/api\/v1\/auth; .*HttpOnly; Secure; SameSite=Strict$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('never puts the tokens in the response body', async () => {
      authService.verifyEmail.mockResolvedValue(signedIn);

      const res = await verify(validBody).expect(200);
      expect(res.text).not.toContain(tokens.accessToken);
      expect(res.text).not.toContain(tokens.refreshToken);
    });

    it('sets no cookie when the verification fails', async () => {
      authService.verifyEmail.mockRejectedValue(
        new BadRequestException({
          statusCode: 400,
          code: 'OTP_INVALID',
          message: 'Verification code is invalid',
        }),
      );

      const res = await verify(validBody).expect(400);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('normalizes the email', async () => {
      authService.verifyEmail.mockResolvedValue(signedIn);

      await verify({ ...validBody, email: ' Victory.DEO@Example.com ' }).expect(
        200,
      );
      expect(authService.verifyEmail).toHaveBeenCalledWith(validBody);
    });

    it.each([
      ['missing code', { email: profile.email }],
      ['code too short', { ...validBody, code: '12345' }],
      ['code too long', { ...validBody, code: '1234567' }],
      ['code with letters', { ...validBody, code: '12a456' }],
      ['numeric code', { ...validBody, code: 42137 }],
      ['invalid email', { ...validBody, email: 'nope' }],
      ['unknown field', { ...validBody, userId: 'u-1' }],
    ])('rejects %s with 400', async (_label, body) => {
      await verify(body).expect(400);
      expect(authService.verifyEmail).not.toHaveBeenCalled();
    });

    it('returns the error body produced by the service', async () => {
      const body = {
        statusCode: 400,
        code: 'OTP_INVALID',
        message: 'Verification code is invalid',
      };
      authService.verifyEmail.mockRejectedValue(new BadRequestException(body));

      await verify(validBody).expect(400).expect(body);
    });
  });

  describe('POST /auth/resend-verification-code', () => {
    const resend = (body: object) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification-code')
        .send(body);

    it('answers 200 with a generic message', async () => {
      authService.resendVerificationCode.mockResolvedValue(undefined);

      await resend({ email: profile.email })
        .expect(200)
        .expect({ message: RESEND_CODE_MESSAGE });
    });

    it('normalizes the email', async () => {
      authService.resendVerificationCode.mockResolvedValue(undefined);

      await resend({ email: ' Victory.DEO@Example.com ' }).expect(200);
      expect(authService.resendVerificationCode).toHaveBeenCalledWith({
        email: profile.email,
      });
    });

    it.each([
      ['missing email', {}],
      ['invalid email', { email: 'nope' }],
      ['unknown field', { email: profile.email, userId: 'u-1' }],
    ])('rejects %s with 400', async (_label, body) => {
      await resend(body).expect(400);
      expect(authService.resendVerificationCode).not.toHaveBeenCalled();
    });

    it('returns the 429 body produced by the service', async () => {
      const body = {
        statusCode: 429,
        code: 'OTP_RESEND_TOO_SOON',
        message: 'A code was sent recently, please wait before asking again',
      };
      authService.resendVerificationCode.mockRejectedValue(
        new HttpException(body, 429),
      );

      await resend({ email: profile.email }).expect(429).expect(body);
    });
  });

  describe('POST /auth/refresh', () => {
    const refresh = () =>
      request(app.getHttpServer()).post('/api/v1/auth/refresh');
    const tokens = {
      sessionId: 's-1',
      accessToken: 'new.access.jwt',
      refreshToken: 'new.refresh.jwt',
      accessTtlSeconds: 900,
      refreshTtlSeconds: 604_800,
    };

    it('rotates the session behind the refresh cookie and sets the new cookies', async () => {
      authService.refresh.mockResolvedValue(tokens);

      const res = await refresh()
        .expect(200)
        .expect({ message: REFRESH_SUCCESS_MESSAGE });

      expect(authService.refresh).toHaveBeenCalledWith(refreshSession);
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      expect(cookies).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^access_token=new\.access\.jwt; .*HttpOnly/),
          expect.stringMatching(
            /^refresh_token=new\.refresh\.jwt; .*Path=\/api\/v1\/auth; .*HttpOnly/,
          ),
        ]),
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.text).not.toContain(tokens.refreshToken);
    });

    it('sets no cookie when the service refuses the refresh', async () => {
      authService.refresh.mockRejectedValue(
        new UnauthorizedException({
          statusCode: 401,
          code: 'REFRESH_TOKEN_INVALID',
          message: 'Session expired, please sign in again',
        }),
      );

      const res = await refresh().expect(401);
      expect(res.body.code).toBe('REFRESH_TOKEN_INVALID');
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });
});
