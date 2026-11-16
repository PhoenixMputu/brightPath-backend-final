import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Outside the /api/v1 prefix, like the other non-API routes. */
export const SWAGGER_PATH = 'docs';

/** Serves the OpenAPI UI at /docs and the JSON spec at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('BrightPath API')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    SwaggerModule.createDocument(app, config),
    { useGlobalPrefix: false },
  );
}
