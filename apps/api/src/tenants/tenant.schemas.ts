import { z } from 'zod';

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  locale: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/)
    .default('ar-DZ'),
  timezone: z.string().trim().min(1).max(64).refine(isIanaTimezone).default('Africa/Algiers'),
});

export const tenantIdSchema = z.string().uuid();

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
