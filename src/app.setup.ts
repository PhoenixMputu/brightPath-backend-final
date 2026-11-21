import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { API_PREFIX } from './common/api-prefix.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

/** HTTP-level configuration shared by main.ts and the tests. */
export function configureApp(app: INestApplication) {
  app.use(helmet());
  // Fills `req.cookies`, where the JWT strategy reads the access token.
  // Unsigned: the tokens are signed JWTs already.
  app.use(cookieParser());
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      // Applies DTO defaults and @Type() conversions (e.g. "?page=2" -> 2).
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  return app;
}
