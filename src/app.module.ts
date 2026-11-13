import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProvinceModule } from './province/province.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    ProvinceModule,
    HealthModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
