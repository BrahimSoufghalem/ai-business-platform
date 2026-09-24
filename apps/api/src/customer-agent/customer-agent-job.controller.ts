import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { CustomerAgentJobProcessorService } from './customer-agent-job-processor.service.js';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function verifyInternalWorkerToken(
  supplied: string | undefined,
  expected = process.env.INTERNAL_WORKER_TOKEN?.trim() ?? '',
): boolean {
  if (expected.length < 32 || !supplied) return false;
  return timingSafeEqual(digest(supplied), digest(expected));
}

@Public()
@Controller('internal/customer-agent-jobs')
export class CustomerAgentJobController {
  constructor(
    @Inject(CustomerAgentJobProcessorService)
    private readonly processor: CustomerAgentJobProcessorService,
  ) {}

  @Post('process-next')
  @HttpCode(200)
  processNext(
    @Headers('x-worker-token') token: string | undefined,
    @Headers('x-worker-id') workerId: string | undefined,
  ) {
    const configuredToken = process.env.INTERNAL_WORKER_TOKEN?.trim() ?? '';
    if (configuredToken.length < 32) {
      throw new ServiceUnavailableException('Internal worker authentication is not configured.');
    }
    if (!verifyInternalWorkerToken(token, configuredToken)) {
      throw new UnauthorizedException('Invalid internal worker credential.');
    }
    return this.processor.processNext(workerId ?? '');
  }
}
