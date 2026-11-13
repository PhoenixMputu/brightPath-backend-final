import { Injectable, Logger } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { withTimeout } from '../common/utils/with-timeout.js';
import { PrismaService } from './prisma.service.js';

/** Generous: opening a new TLS connection to the remote database is slow. */
export const DATABASE_HEALTH_TIMEOUT_MS = 3_000;

@Injectable()
export class PrismaHealthIndicator {
  private readonly logger = new Logger(PrismaHealthIndicator.name);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async isHealthy<const Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await withTimeout(
        this.prisma.$queryRaw`SELECT 1`,
        DATABASE_HEALTH_TIMEOUT_MS,
      );
      return indicator.up();
    } catch (err) {
      // The Prisma error can contain connection details: log it, never return it.
      this.logger.error(`Database health check failed: ${String(err)}`);
      return indicator.down({ message: 'Database is unreachable' });
    }
  }
}
