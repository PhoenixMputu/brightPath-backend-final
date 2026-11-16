import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { buildCorsOptions } from './common/utils/cors.js';
import type { Env } from './config/env.schema.js';
import { setupSwagger } from './swagger.js';

async function bootstrap() {
  // Startup logs are buffered until pino takes over, so every line is JSON.
  const app = configureApp(
    await NestFactory.create(AppModule, { bufferLogs: true }),
  );
  app.useLogger(app.get(Logger));
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Browsers may call the API only from the allowlisted frontend origins.
  app.enableCors(buildCorsOptions(config.get('CORS_ORIGINS', { infer: true })));
  // Runs onApplicationShutdown (Redis/Prisma disconnect) on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) setupSwagger(app);

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
