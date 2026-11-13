import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
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
