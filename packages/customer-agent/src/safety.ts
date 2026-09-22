const injectionPatterns: readonly RegExp[] = [
  /\bignore\s+(all\s+)?(previous|prior|system|developer)\s+instructions?\b/iu,
  /\b(system|developer)\s+prompt\b/iu,
  /\b(reveal|show|print|leak)\b.{0,40}\b(prompt|instructions?|secret|api[\s_-]?key)\b/iu,
  /\bjailbreak\b|\bdo\s+anything\s+now\b|\bDAN\b/u,
  /\bignorez?\b.{0,30}\b(instructions?|syst[eè]me)\b/iu,
  /تجاهل.{0,30}(التعليمات|الأوامر|النظام)/u,
  /(اكشف|اعرض|اطبع|سرّب).{0,40}(التعليمات|البرومبت|المفتاح|الأسرار|رسالة النظام)/u,
  /(تصرف|تصرّف).{0,20}(كمطور|كنظام|بدون قيود)/u,
];

const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const phonePattern = /(?<![\p{L}\p{N}])(?:\+?\d[\d\s()-]{7,}\d)(?![\p{L}\p{N}])/gu;
const cardPattern = /(?<!\d)(?:\d[ -]*?){13,19}(?!\d)/gu;

export interface CustomerInputSafetyAssessment {
  readonly safe: boolean;
  readonly reason: 'safe' | 'prompt_injection';
}

export function assessCustomerInput(value: string): CustomerInputSafetyAssessment {
  const bounded = value.slice(0, 20_000);
  return injectionPatterns.some((pattern) => pattern.test(bounded))
    ? { safe: false, reason: 'prompt_injection' }
    : { safe: true, reason: 'safe' };
}

export function redactCustomerText(value: string, maximumLength = 2_000): string {
  const bounded = value.slice(0, maximumLength);
  return bounded
    .replace(bearerPattern, '[REDACTED_TOKEN]')
    .replace(emailPattern, '[REDACTED_EMAIL]')
    .replace(phonePattern, (candidate) => {
      const digits = candidate.replace(/\D/gu, '');
      return digits.length >= 9 && digits.length <= 15 ? '[REDACTED_PHONE]' : candidate;
    })
    .replace(cardPattern, '[REDACTED_NUMBER]');
}

export function boundedUntrustedText(value: string, maximumLength: number): string {
  return redactCustomerText(value.replace(/\0/gu, '').trim(), maximumLength);
}
