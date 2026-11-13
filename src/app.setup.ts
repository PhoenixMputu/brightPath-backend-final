import { INestApplication, ValidationPipe } from '@nestjs/common';

/** HTTP-level configuration shared by main.ts and the tests. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      // Applies DTO defaults and @Type() conversions (e.g. "?page=2" -> 2).
      transform: true,
    }),
  );
  return app;
}
