import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { DatabaseService } from '../database/database.service.js';
import { CustomerAgentService } from './customer-agent.service.js';

const SERVICE_IDENTITY: VerifiedIdentity = {
  subject: 'service:customer-agent-worker',
  issuer: 'internal-service',
  actorType: 'service',
};
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

interface ClaimedAgentJob {
  readonly jobId: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly correlationId: string;
}

export type CustomerAgentJobResult =
  | { readonly status: 'idle' }
  | {
      readonly status: 'completed' | 'retry' | 'dead';
      readonly jobId: string;
    };

function permanentFailure(error: unknown): boolean {
  if (error instanceof NotFoundException || error instanceof ConflictException) return true;
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
  }
  return false;
}

function redactedErrorCode(error: unknown): string {
  if (error instanceof NotFoundException) return 'agent_input_not_found';
  if (error instanceof ConflictException) return 'agent_input_conflict';
  if (error instanceof HttpException) return `agent_http_${error.getStatus()}`;
  return 'agent_processing_error';
}

@Injectable()
export class CustomerAgentJobProcessorService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CustomerAgentService) private readonly customerAgent: CustomerAgentService,
  ) {}

  async processNext(workerId: string): Promise<CustomerAgentJobResult> {
    if (!/^[A-Za-z0-9._:-]{1,100}$/u.test(workerId)) {
      throw new Error('Customer-agent worker ID is invalid.');
    }
    const [job] = await this.database.client<ClaimedAgentJob[]>`
      select
        job_id::text as "jobId",
        tenant_id::text as "tenantId",
        conversation_id::text as "conversationId",
        source_message_id::text as "sourceMessageId",
        attempts,
        max_attempts as "maxAttempts",
        correlation_id as "correlationId"
      from app_claim_message_processing_job(${workerId})
    `;
    if (!job) return { status: 'idle' };

    try {
      await this.customerAgent.reply(
        SERVICE_IDENTITY,
        job.correlationId,
        job.tenantId,
        job.conversationId,
        { messageId: job.sourceMessageId },
      );
    } catch (error) {
      const canRetry = !permanentFailure(error) && job.attempts < job.maxAttempts;
      const delayMs = Math.min(
        BASE_RETRY_DELAY_MS * 2 ** Math.min(Math.max(job.attempts - 1, 0), 30),
        MAX_RETRY_DELAY_MS,
      );
      const retryAt = canRetry ? new Date(Date.now() + delayMs).toISOString() : null;
      const [failed] = await this.database.client<{ status: 'pending' | 'dead' }[]>`
        select app_fail_message_processing_job(
          ${job.jobId}::uuid,
          ${workerId},
          ${redactedErrorCode(error)},
          ${retryAt}
        ) as status
      `;
      return {
        status: failed?.status === 'pending' ? 'retry' : 'dead',
        jobId: job.jobId,
      };
    }

    // Completion persistence is outside the reply-failure branch. If the database
    // acknowledgement fails, the lease expires and the idempotent reply is replayed.
    await this.database.client`
      select app_complete_message_processing_job(${job.jobId}::uuid, ${workerId})
    `;
    return { status: 'completed', jobId: job.jobId };
  }
}
