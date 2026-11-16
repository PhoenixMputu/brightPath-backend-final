import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { buildCorsOptions } from './common/utils/cors.js';
import type { Env } from './config/env.schema.js';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Browsers may call the API only from the allowlisted frontend origins.
  app.enableCors(buildCorsOptions(config.get('CORS_ORIGINS', { infer: true })));
  // Runs onApplicationShutdown (Redis/Prisma disconnect) on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BrightPath API')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
