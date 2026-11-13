import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
} from '@nestjs/terminus';
import { PrismaHealthIndicator } from '../../prisma/prisma.health.js';
import { RedisHealthIndicator } from '../../redis/redis.health.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks the database and Redis. Returns 503 when the database is down. ' +
      'A Redis outage only marks the service as degraded (200), since the API ' +
      'falls back to the database.',
  })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }

  @Get('live')
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns 200 as long as the process is running. Checks no dependency, ' +
      'so an orchestrator never restarts the app because of a database outage.',
  })
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
