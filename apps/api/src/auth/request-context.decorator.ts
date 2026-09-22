import { UnauthorizedException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import type { AuthenticatedRequest } from './authenticated-request.js';

export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VerifiedIdentity => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.identity) throw new UnauthorizedException();
    return request.identity;
  },
);

export const CorrelationId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.correlationId) throw new UnauthorizedException();
    return request.correlationId;
  },
);
