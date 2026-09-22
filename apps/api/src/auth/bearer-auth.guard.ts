import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IdentityVerifier } from '@ai-business/auth';
import { IDENTITY_VERIFIER, IS_PUBLIC_ROUTE } from './auth.constants.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

export function extractBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function selectCorrelationId(header: string | string[] | undefined): string {
  if (typeof header === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(header)) {
    return header;
  }
  return randomUUID();
}

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(IDENTITY_VERIFIER) private readonly verifier: IdentityVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('A valid Bearer token is required.');
    }

    try {
      request.identity = await this.verifier.verify(token);
      request.correlationId = selectCorrelationId(request.headers['x-correlation-id']);
      return true;
    } catch {
      throw new UnauthorizedException('The access token is invalid or expired.');
    }
  }
}
