import { ConflictException } from '@nestjs/common';
import type { DatabaseClient } from '@ai-business/db';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../src/database/database.service.js';
import { verifyInternalWorkerToken } from '../src/customer-agent/customer-agent-job.controller.js';
import { CustomerAgentJobProcessorService } from '../src/customer-agent/customer-agent-job-processor.service.js';
import type { CustomerAgentService } from '../src/customer-agent/customer-agent.service.js';

const claimedJob = {
  jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  sourceMessageId: '33333333-3333-4333-8333-333333333333',
  attempts: 1,
  maxAttempts: 5,
  correlationId: 'correlation-1',
};

function setup(options: {
  readonly job?: typeof claimedJob | null;
  readonly replyError?: unknown;
  readonly failedStatus?: 'pending' | 'dead';
}) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    calls.push({ sql, values });
    if (sql.includes('app_claim_message_processing_job')) {
      return options.job === null ? [] : [options.job ?? claimedJob];
    }
    if (sql.includes('app_fail_message_processing_job')) {
      return [{ status: options.failedStatus ?? 'pending' }];
    }
    return [{}];
  }) as DatabaseClient;
  const reply = options.replyError
    ? vi.fn().mockRejectedValue(options.replyError)
    : vi.fn().mockResolvedValue({ messageId: 'reply-1' });
  const processor = new CustomerAgentJobProcessorService(
    { client } as DatabaseService,
    { reply } as unknown as CustomerAgentService,
  );
  return { processor, reply, calls };
}

describe('CustomerAgentJobProcessorService', () => {
  it('returns idle when no inbound message job is due', async () => {
    const { processor, reply } = setup({ job: null });
    await expect(processor.processNext('worker:test')).resolves.toEqual({ status: 'idle' });
    expect(reply).not.toHaveBeenCalled();
  });

  it('runs the customer agent as the internal service principal and completes the lease', async () => {
    const { processor, reply, calls } = setup({});
    await expect(processor.processNext('worker:test')).resolves.toEqual({
      status: 'completed',
      jobId: claimedJob.jobId,
    });
    expect(reply).toHaveBeenCalledWith(
      {
        subject: 'service:customer-agent-worker',
        issuer: 'internal-service',
        actorType: 'service',
      },
      claimedJob.correlationId,
      claimedJob.tenantId,
      claimedJob.conversationId,
      { messageId: claimedJob.sourceMessageId },
    );
    expect(calls.some((call) => call.sql.includes('app_complete_message_processing_job'))).toBe(
      true,
    );
  });

  it('persists a redacted retry for transient failures', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
    const { processor, calls } = setup({ replyError: new Error('secret provider response') });

    await expect(processor.processNext('worker:test')).resolves.toEqual({
      status: 'retry',
      jobId: claimedJob.jobId,
    });
    const failure = calls.find((call) => call.sql.includes('app_fail_message_processing_job'));
    expect(failure?.values).toEqual([
      claimedJob.jobId,
      'worker:test',
      'agent_processing_error',
      '2026-09-24T12:00:30.000Z',
    ]);
    expect(JSON.stringify(failure)).not.toContain('secret provider response');
    vi.useRealTimers();
  });

  it('dead-letters permanent conflicts without retrying', async () => {
    const { processor, calls } = setup({
      replyError: new ConflictException('stale inbound message'),
      failedStatus: 'dead',
    });

    await expect(processor.processNext('worker:test')).resolves.toEqual({
      status: 'dead',
      jobId: claimedJob.jobId,
    });
    const failure = calls.find((call) => call.sql.includes('app_fail_message_processing_job'));
    expect(failure?.values).toEqual([
      claimedJob.jobId,
      'worker:test',
      'agent_input_conflict',
      null,
    ]);
  });
});

describe('verifyInternalWorkerToken', () => {
  const token = 'worker-token-with-at-least-thirty-two-characters';

  it('compares the configured secret without accepting prefixes', () => {
    expect(verifyInternalWorkerToken(token, token)).toBe(true);
    expect(verifyInternalWorkerToken(`${token}-wrong`, token)).toBe(false);
    expect(verifyInternalWorkerToken(undefined, token)).toBe(false);
  });
});
