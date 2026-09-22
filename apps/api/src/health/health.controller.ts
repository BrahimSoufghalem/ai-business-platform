import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@ai-business/shared';

@Controller('health')
export class HealthController {
  @Get('live')
  liveness(): HealthStatus {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  readiness(): HealthStatus {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
