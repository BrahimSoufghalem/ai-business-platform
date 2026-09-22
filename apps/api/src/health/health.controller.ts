import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@ai-business/shared';
import { Public } from '../auth/public.decorator.js';

@Public()
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
