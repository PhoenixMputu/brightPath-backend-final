import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ACCESS_TOKEN_COOKIE } from './modules/auth/auth-cookies.js';

/** Outside the /api/v1 prefix, like the other non-API routes. */
export const SWAGGER_PATH = 'docs';

/** Serves the OpenAPI UI at /docs and the JSON spec at /docs-json. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('BrightPath API')
    .setVersion('1.0')
    // Routes marked @ApiCookieAuth(ACCESS_TOKEN_COOKIE) need the cookie set
    // by POST /auth/verify-email; the browser sends it with "Try it out".
    .addCookieAuth(
      ACCESS_TOKEN_COOKIE,
      {
        type: 'apiKey',
        in: 'cookie',
        name: ACCESS_TOKEN_COOKIE,
        description: 'httpOnly cookie set when the user signs in.',
      },
      ACCESS_TOKEN_COOKIE,
    )
    .build();
  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    SwaggerModule.createDocument(app, config),
    { useGlobalPrefix: false },
  );
}
