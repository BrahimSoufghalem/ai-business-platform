import type { VerifiedIdentity } from '@ai-business/auth';

export interface AuthenticatedRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  identity?: VerifiedIdentity;
  correlationId?: string;
}
