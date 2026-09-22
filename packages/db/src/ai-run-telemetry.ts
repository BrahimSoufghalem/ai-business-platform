import { redactAiTelemetry, type AiRunTraceRecord } from '@ai-business/ai-gateway';
import type { TenantTransaction } from './client.js';

type JsonInput = Parameters<TenantTransaction['json']>[0];

function jsonInput(value: unknown): JsonInput {
  return value as JsonInput;
}

/**
 * Persists one complete gateway trace atomically. The caller must provide a
 * tenant-scoped transaction; RLS independently verifies the active tenant.
 */
export async function persistAiRunTrace(
  transaction: TenantTransaction,
  run: AiRunTraceRecord,
): Promise<void> {
  const safeInput = redactAiTelemetry(run.safeInput);
  const safeOutput = redactAiTelemetry(run.safeOutput);
  const safeAttempts = redactAiTelemetry(run.attempts);
  await transaction`
    insert into ai_runs (
      id, tenant_id, conversation_id, task, intent, prompt_version,
      routing_version, provider, model, model_version, outcome,
      handoff_reason, latency_ms, input_tokens, output_tokens,
      estimated_cost_usd, attempt_count, fallback_used, safe_input,
      safe_output, attempts, correlation_id, created_at
    ) values (
      ${run.id}, ${run.tenantId}, ${run.conversationId}, ${run.task},
      ${run.intent}, ${run.promptVersion}, ${run.routingVersion},
      ${run.provider}, ${run.model}, ${run.modelVersion}, ${run.outcome},
      ${run.handoffReason}, ${run.latencyMs}, ${run.usage.inputTokens},
      ${run.usage.outputTokens}, ${run.estimatedCostUsd},
      ${run.attemptCount}, ${run.fallbackUsed},
      ${transaction.json(jsonInput(safeInput))},
      ${transaction.json(jsonInput(safeOutput))},
      ${transaction.json(jsonInput(safeAttempts))},
      ${run.correlationId}, ${run.createdAt}
    )
  `;
  for (const tool of run.toolCalls) {
    await transaction`
      insert into ai_tool_calls (
        id, tenant_id, run_id, provider_call_id, name, kind, status,
        latency_ms, safe_input, safe_output, error_code
      ) values (
        ${tool.id}, ${run.tenantId}, ${run.id}, ${tool.providerCallId},
        ${tool.name}, ${tool.kind}, ${tool.status}, ${tool.latencyMs},
        ${transaction.json(jsonInput(redactAiTelemetry(tool.safeInput)))},
        ${transaction.json(jsonInput(redactAiTelemetry(tool.safeOutput)))},
        ${tool.errorCode}
      )
    `;
  }
}
