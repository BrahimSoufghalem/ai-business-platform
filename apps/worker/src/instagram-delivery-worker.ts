import {
  attemptInstagramDelivery,
  InstagramCredentialError,
  InstagramLiveAdapter,
  type InstagramAdapter,
  type InstagramCredentialVault,
  type InstagramDeliveryPolicyOptions,
} from '@ai-business/integrations';
import type {
  ClaimedInstagramDelivery,
  InstagramDeliveryQueue,
} from './instagram-delivery-queue.js';

const RECIPIENT_ID = /^[0-9]{1,80}$/u;

export type InstagramDeliveryWorkerResult = 'idle' | 'delivered' | 'retry' | 'dead';

export interface InstagramDeliveryAdapterFactoryInput {
  readonly accountId: string;
  readonly accessToken: string;
  readonly appSecret: string;
}

export interface InstagramDeliveryWorkerOptions {
  readonly workerId: string;
  readonly queue: InstagramDeliveryQueue;
  readonly credentialVault: Pick<InstagramCredentialVault, 'decrypt'>;
  readonly appSecret: string;
  readonly adapterFactory?: (input: InstagramDeliveryAdapterFactoryInput) => InstagramAdapter;
  readonly policy?: InstagramDeliveryPolicyOptions;
}

function defaultAdapterFactory(input: InstagramDeliveryAdapterFactoryInput): InstagramAdapter {
  return new InstagramLiveAdapter(input);
}

export class InstagramDeliveryWorker {
  private readonly adapterFactory: (
    input: InstagramDeliveryAdapterFactoryInput,
  ) => InstagramAdapter;

  constructor(private readonly options: InstagramDeliveryWorkerOptions) {
    if (!/^[A-Za-z0-9._:-]{1,100}$/u.test(options.workerId)) {
      throw new Error('Instagram delivery worker ID is invalid.');
    }
    if (options.appSecret.trim().length < 16) {
      throw new Error('Instagram app secret is missing or too short.');
    }
    this.adapterFactory = options.adapterFactory ?? defaultAdapterFactory;
  }

  private async terminalFailure(job: ClaimedInstagramDelivery, errorCode: string): Promise<'dead'> {
    await this.options.queue.fail(job.jobId, this.options.workerId, errorCode, null);
    return 'dead';
  }

  async processNext(): Promise<InstagramDeliveryWorkerResult> {
    const job = await this.options.queue.claim(this.options.workerId);
    if (!job) return 'idle';
    if (!job.account || job.account.status !== 'active') {
      return this.terminalFailure(job, 'connection_unavailable');
    }
    if (!job.recipientId || !RECIPIENT_ID.test(job.recipientId)) {
      return this.terminalFailure(job, 'invalid_recipient');
    }

    let accessToken: string;
    try {
      accessToken = this.options.credentialVault.decrypt(
        { tenantId: job.tenantId, accountId: job.account.id },
        job.account.encryptedToken,
      );
    } catch (error) {
      if (error instanceof InstagramCredentialError || error instanceof Error) {
        return this.terminalFailure(job, 'credential_decryption_error');
      }
      throw error;
    }

    let adapter: InstagramAdapter;
    try {
      adapter = this.adapterFactory({
        accountId: job.account.id,
        accessToken,
        appSecret: this.options.appSecret,
      });
    } catch {
      return this.terminalFailure(job, 'adapter_configuration_error');
    }

    const disposition = await attemptInstagramDelivery(
      adapter,
      {
        conversationId: job.recipientId,
        text: job.content,
        attempts: Math.max(0, job.attempts - 1),
        maxAttempts: job.maxAttempts,
      },
      this.options.policy,
    );

    if (disposition.status === 'delivered') {
      await this.options.queue.complete(
        job.jobId,
        this.options.workerId,
        disposition.result.externalMessageId,
      );
      return 'delivered';
    }
    if (disposition.status === 'retry') {
      const status = await this.options.queue.fail(
        job.jobId,
        this.options.workerId,
        disposition.errorCode,
        disposition.availableAt,
      );
      return status === 'pending' ? 'retry' : 'dead';
    }
    return this.terminalFailure(job, disposition.errorCode);
  }

  async run(
    signal: AbortSignal,
    options: {
      readonly idleDelayMs?: number;
      readonly errorDelayMs?: number;
      readonly onError?: (error: unknown) => void;
    } = {},
  ): Promise<void> {
    const idleDelayMs = options.idleDelayMs ?? 1_000;
    const errorDelayMs = options.errorDelayMs ?? 5_000;
    while (!signal.aborted) {
      let delayMs = 0;
      try {
        if ((await this.processNext()) === 'idle') delayMs = idleDelayMs;
      } catch (error) {
        options.onError?.(error);
        delayMs = errorDelayMs;
      }
      if (delayMs > 0 && !signal.aborted) {
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            clearTimeout(timeout);
            resolve();
          };
          const timeout = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, delayMs);
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
    }
  }
}
