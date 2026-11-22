import {
  Controller,
  type INestApplication,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../../app.setup.js';
import { CurrentRefreshSession } from '../decorators/current-refresh-session.decorator.js';
import { REFRESH_TOKEN_INVALID_CODE } from '../refresh-token-invalid.js';
import {
  JwtRefreshStrategy,
  type RefreshSession,
} from '../strategies/jwt-refresh.strategy.js';
import { JwtRefreshGuard } from './jwt-refresh.guard.js';

const ACCESS_SECRET = 'a'.repeat(32);
const REFRESH_SECRET = 'r'.repeat(32);

@Controller('probe')
class ProbeController {
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  refresh(@CurrentRefreshSession() session: RefreshSession): RefreshSession {
    return session;
  }
}

/** The real guard, strategy, decorator and cookie parsing, on a probe route. */
describe('JwtRefreshGuard with JwtRefreshStrategy', () => {
  let app: INestApplication;
  const jwt = new JwtService({});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProbeController],
      providers: [
        JwtRefreshStrategy,
        { provide: ConfigService, useValue: { get: () => REFRESH_SECRET } },
      ],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(() => app.close());

  const sign = (
    payload: object,
    { secret = REFRESH_SECRET, expiresIn = 600 } = {},
  ) => jwt.signAsync(payload, { secret, expiresIn, algorithm: 'HS256' });
  const claims = { sub: 'u-1', sid: 's-1', typ: 'refresh' };

  const refresh = (cookie?: string) => {
    const req = request(app.getHttpServer()).post('/api/v1/probe/refresh');
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const expectRefused = async (res: request.Test) => {
    const { body } = await res.expect(401);
    expect(body).toEqual({
      statusCode: 401,
      code: REFRESH_TOKEN_INVALID_CODE,
      message: 'Session expired, please sign in again',
    });
  };

  it('accepts a valid refresh cookie and exposes the session with its raw token', async () => {
    const token = await sign(claims);
    await refresh(`refresh_token=${token}`).expect(201, {
      userId: 'u-1',
      sessionId: 's-1',
      refreshToken: token,
    });
  });

  it('refuses a request without the cookie', async () => {
    await expectRefused(refresh());
  });

  it('ignores a token sent in the Authorization header', async () => {
    const token = await sign(claims);
    await expectRefused(refresh().set('Authorization', `Bearer ${token}`));
  });

  it('ignores the access cookie', async () => {
    const token = await sign(claims);
    await expectRefused(refresh(`access_token=${token}`));
  });

  it('refuses an access token used as a refresh token', async () => {
    const accessClaims = { ...claims, typ: 'access' };
    // Even if it were signed with the refresh secret.
    for (const secret of [ACCESS_SECRET, REFRESH_SECRET]) {
      const token = await sign(accessClaims, { secret });
      await expectRefused(refresh(`refresh_token=${token}`));
    }
  });

  it('refuses an expired refresh token', async () => {
    const token = await sign(claims, { expiresIn: -10 });
    await expectRefused(refresh(`refresh_token=${token}`));
  });

  it('refuses a token signed with another secret', async () => {
    const token = await sign(claims, { secret: 'x'.repeat(32) });
    await expectRefused(refresh(`refresh_token=${token}`));
  });

  it('refuses an unsigned token (alg none)', async () => {
    const encode = (part: object) =>
      Buffer.from(JSON.stringify(part)).toString('base64url');
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`;
    await expectRefused(refresh(`refresh_token=${token}`));
  });

  it.each([
    ['without a subject', { sid: 's-1', typ: 'refresh' }],
    ['without a session', { sub: 'u-1', typ: 'refresh' }],
    ['with an empty session', { sub: 'u-1', sid: '', typ: 'refresh' }],
  ])('refuses a token %s', async (_label, payload) => {
    const token = await sign(payload);
    await expectRefused(refresh(`refresh_token=${token}`));
  });

  it('lets an unexpected error through instead of answering 401', () => {
    const bug = new Error('strategy bug');
    expect(() => new JwtRefreshGuard().handleRequest(bug, false)).toThrow(bug);
  });

  it('maps a passport rejection to 401 REFRESH_TOKEN_INVALID', () => {
    expect(() =>
      new JwtRefreshGuard().handleRequest(new UnauthorizedException(), false),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: REFRESH_TOKEN_INVALID_CODE }),
      }),
    );
  });

  it('refuses a malformed cookie', async () => {
    await expectRefused(refresh('refresh_token=not-a-jwt'));
  });
});
