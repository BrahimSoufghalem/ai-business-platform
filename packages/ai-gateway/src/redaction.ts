const redacted = '[REDACTED]';
const truncated = '[TRUNCATED]';
const maximumDepth = 8;
const maximumArrayItems = 100;
const maximumStringLength = 2_000;

const sensitiveKey =
  /(?:authorization|password|passcode|token|secret|api[_-]?key|cookie|session|otp|cvv|card|email|phone|address|contact)/i;
const bearerToken = /\bBearer\s+[A-Za-z0-9._~+/=-]{7,}[A-Za-z0-9_~+/=-]/gi;
const jwtToken = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const emailAddress = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const internationalPhone = /(?<![A-Za-z0-9-])(?:\+|00)\d(?:[\s().-]?\d){7,14}(?![A-Za-z0-9-])/g;

function redactString(value: string): string {
  const safe = value
    .replace(bearerToken, redacted)
    .replace(jwtToken, redacted)
    .replace(emailAddress, redacted)
    .replace(internationalPhone, redacted);
  if (safe.length <= maximumStringLength) return safe;
  return `${safe.slice(0, maximumStringLength)}${truncated}`;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > maximumDepth) return truncated;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return '[UNSERIALIZABLE]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, maximumArrayItems)
      .map((item) => redactValue(item, depth + 1, seen));
    if (value.length > maximumArrayItems) items.push(truncated);
    return items;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = sensitiveKey.test(key) ? redacted : redactValue(item, depth + 1, seen);
  }
  return output;
}

/** Produces bounded JSON-safe telemetry without credentials or direct contact data. */
export function redactAiTelemetry(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet<object>());
}
