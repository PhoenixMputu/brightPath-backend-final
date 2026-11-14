import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { buildCorsOptions, parseCorsOrigins } from './common/utils/cors.js';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  // Browsers may call the API only from the allowlisted frontend origins.
  app.enableCors(
    buildCorsOptions(
      parseCorsOrigins(app.get(ConfigService).get<string>('CORS_ORIGINS')),
    ),
  );
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

  await app.listen(process.env.PORT ?? 8000);
}
await bootstrap();
