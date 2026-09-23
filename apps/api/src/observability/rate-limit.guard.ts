import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string, limit: number): RateLimitDecision {
    const currentTime = this.now();
    const cutoff = currentTime - this.windowMs;
    const recent = (this.buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= limit) {
      this.buckets.set(key, recent);
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(((recent[0] ?? currentTime) + this.windowMs - currentTime) / 1_000),
        ),
      };
    }
    recent.push(currentTime);
    this.buckets.set(key, recent);
    if (this.buckets.size > 10_000) {
      for (const [bucketKey, timestamps] of this.buckets) {
        if ((timestamps.at(-1) ?? 0) <= cutoff) this.buckets.delete(bucketKey);
      }
    }
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - recent.length),
      retryAfterSeconds: 0,
    };
  }
}

function positiveEnvironmentInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function normalizeRateLimitPath(url: string): string {
  return (url.split('?', 1)[0] ?? '/')
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/giu,
      '/:id',
    )
    .replace(/\/\d+(?=\/|$)/gu, '/:id');
}

interface RateLimitedRequest {
  readonly method?: string;
  readonly url?: string;
  readonly ip?: string;
  readonly identity?: VerifiedIdentity;
}

interface HeaderResponse {
  header(name: string, value: string): void;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windowMs = positiveEnvironmentInteger('RATE_LIMIT_WINDOW_MS', 60_000);
  private readonly standardLimit = positiveEnvironmentInteger('RATE_LIMIT_MAX_REQUESTS', 120);
  private readonly agentLimit = positiveEnvironmentInteger('RATE_LIMIT_AGENT_MAX_REQUESTS', 30);
  private readonly limiter = new SlidingWindowRateLimiter(this.windowMs);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const response = context.switchToHttp().getResponse<HeaderResponse>();
    const path = normalizeRateLimitPath(request.url ?? '/');
    const subject = request.identity?.subject ?? request.ip ?? 'unknown';
    const limit = path.endsWith('/agent-reply') ? this.agentLimit : this.standardLimit;
    const decision = this.limiter.consume(
      `${subject}:${request.method ?? 'UNKNOWN'}:${path}`,
      limit,
    );
    response.header('X-RateLimit-Limit', String(decision.limit));
    response.header('X-RateLimit-Remaining', String(decision.remaining));
    if (decision.allowed) return true;

    response.header('Retry-After', String(decision.retryAfterSeconds));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many requests. Retry after the indicated delay.',
        retryAfterSeconds: decision.retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
