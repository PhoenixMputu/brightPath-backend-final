import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnv } from './config/env.schema.js';
import { LoggerModule } from './logger/logger.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProvinceModule } from './modules/province/province.module.js';
import { RedisModule } from './redis/redis.module.js';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage.js';
import { DEFAULT_THROTTLE, THROTTLE_ERROR_MESSAGE } from './common/throttle.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    LoggerModule,
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: 'default', ...DEFAULT_THROTTLE }],
        storage,
        errorMessage: THROTTLE_ERROR_MESSAGE,
      }),
    }),
    ProvinceModule,
    HealthModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guards run in this order: rate limiting first, so it also
    // covers unauthenticated requests, then authentication.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
