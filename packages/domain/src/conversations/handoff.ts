export const handoffReasonCodes = [
  'explicit_customer_request',
  'low_confidence',
  'safety_risk',
  'tool_failure',
  'pricing_policy',
  'order_exception',
  'unsupported_request',
  'manual',
] as const;

export type HandoffReasonCode = (typeof handoffReasonCodes)[number];

export const handoffStatuses = ['pending', 'active', 'resolved'] as const;

export type HandoffStatus = (typeof handoffStatuses)[number];

export const handoffResolutionCodes = [
  'completed',
  'returned_to_bot',
  'conversation_closed',
] as const;

export type HandoffResolutionCode = (typeof handoffResolutionCodes)[number];

export function classifyCustomerAgentHandoff(reason: string | null): HandoffReasonCode {
  const value = reason?.toLocaleLowerCase('en') ?? '';
  if (value.includes('explicit_handoff')) return 'explicit_customer_request';
  if (value.includes('unsafe')) return 'safety_risk';
  if (value.includes('tool_')) return 'tool_failure';
  if (value.includes('pricing_policy')) return 'pricing_policy';
  if (value.includes('order') || value.includes('draft') || value.includes('multi_item')) {
    return 'order_exception';
  }
  if (
    value.includes('confidence') ||
    value.includes('ground') ||
    value.includes('evidence') ||
    value.includes('fallback') ||
    value.includes('model_requested')
  ) {
    return 'low_confidence';
  }
  return 'unsupported_request';
}
