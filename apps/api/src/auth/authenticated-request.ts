import type { VerifiedIdentity } from '@ai-business/auth';

export interface AuthenticatedRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly method?: string;
  readonly url?: string;
  readonly ip?: string;
  identity?: VerifiedIdentity;
  correlationId?: string;
}
