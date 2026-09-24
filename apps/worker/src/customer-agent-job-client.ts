export type CustomerAgentJobClientResult = 'idle' | 'completed' | 'retry' | 'dead';

export interface CustomerAgentJobClientOptions {
  readonly apiBaseUrl: string;
  readonly workerId: string;
  readonly workerToken: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

interface ProcessorResponse {
  readonly status?: unknown;
}

export class CustomerAgentJobClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: CustomerAgentJobClientOptions) {
    const baseUrl = new URL(options.apiBaseUrl);
    const localDevelopment =
      baseUrl.protocol === 'http:' &&
      (baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1');
    if (baseUrl.protocol !== 'https:' && !localDevelopment) {
      throw new Error('Internal API base URL must use HTTPS.');
    }
    if (!/^[A-Za-z0-9._:-]{1,100}$/u.test(options.workerId)) {
      throw new Error('Customer-agent worker ID is invalid.');
    }
    if (options.workerToken.trim().length < 32) {
      throw new Error('Internal worker token must contain at least 32 characters.');
    }
    this.timeoutMs = options.timeoutMs ?? 90_000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1_000 ||
      this.timeoutMs > 180_000
    ) {
      throw new Error('Customer-agent request timeout must be between 1000 and 180000ms.');
    }
    this.endpoint = new URL(
      'api/internal/customer-agent-jobs/process-next',
      `${baseUrl.toString().replace(/\/$/u, '')}/`,
    ).toString();
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async processNext(): Promise<CustomerAgentJobClientResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers: {
          'X-Worker-Id': this.options.workerId,
          'X-Worker-Token': this.options.workerToken,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`Customer-agent processor returned HTTP ${response.status}.`);
    }
    const body = (await response.json()) as ProcessorResponse;
    if (
      body.status !== 'idle' &&
      body.status !== 'completed' &&
      body.status !== 'retry' &&
      body.status !== 'dead'
    ) {
      throw new Error('Customer-agent processor returned an invalid status.');
    }
    return body.status;
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
        const result = await this.processNext();
        if (result === 'idle' || result === 'retry') delayMs = idleDelayMs;
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
