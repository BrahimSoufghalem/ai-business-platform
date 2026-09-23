import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { catchError, tap, throwError } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { normalizeRateLimitPath } from './rate-limit.guard.js';

interface LoggedResponse {
  readonly statusCode: number;
  header(name: string, value: string): void;
}

function errorStatus(error: unknown): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'getStatus' in error &&
    typeof error.getStatus === 'function'
  ) {
    const status = error.getStatus();
    if (typeof status === 'number') return status;
  }
  return 500;
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<LoggedResponse>();
    const startedAt = Date.now();
    const correlationId = request.correlationId ?? 'unknown';
    const route = normalizeRateLimitPath(request.url ?? '/');
    response.header('X-Correlation-Id', correlationId);

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          JSON.stringify({
            event: 'http_request',
            correlationId,
            method: request.method ?? 'UNKNOWN',
            route,
            statusCode: response.statusCode,
            durationMs: Math.max(0, Date.now() - startedAt),
          }),
        );
      }),
      catchError((error: unknown) => {
        this.logger.warn(
          JSON.stringify({
            event: 'http_request_failed',
            correlationId,
            method: request.method ?? 'UNKNOWN',
            route,
            statusCode: errorStatus(error),
            durationMs: Math.max(0, Date.now() - startedAt),
            errorType:
              typeof error === 'object' && error !== null && 'name' in error
                ? String(error.name)
                : 'Error',
          }),
        );
        return throwError(() => error);
      }),
    );
  }
}
