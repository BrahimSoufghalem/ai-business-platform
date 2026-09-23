import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { HealthStatus } from '@ai-business/shared';
import { Public } from '../auth/public.decorator.js';
import { DatabaseService } from '../database/database.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get('live')
  liveness(): HealthStatus {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async readiness(): Promise<HealthStatus & { checks: { database: 'ok' } }> {
    try {
      await this.database.client`select 1 as ready`;
      return {
        service: 'api',
        status: 'ok',
        timestamp: new Date().toISOString(),
        checks: { database: 'ok' },
      };
    } catch {
      throw new ServiceUnavailableException({
        service: 'api',
        status: 'degraded',
        timestamp: new Date().toISOString(),
        checks: { database: 'unavailable' },
      });
    }
  }
}
