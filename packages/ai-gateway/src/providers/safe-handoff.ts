import type { AiHandoffReason, AiProvider, AiProviderResponse } from '../contracts.js';

export class SafeHandoffProvider implements AiProvider {
  readonly name: string;
  readonly #reason: AiHandoffReason;

  constructor(options?: { name?: string; reason?: AiHandoffReason }) {
    this.name = options?.name ?? 'safe-handoff';
    this.#reason = options?.reason ?? 'safety_fallback';
  }

  async complete(): Promise<AiProviderResponse> {
    return {
      kind: 'handoff',
      reason: this.#reason,
      providerRequestId: null,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
