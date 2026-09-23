import { z } from 'zod';

export const dashboardQuerySchema = z
  .object({
    range: z.enum(['7d', '30d', '90d']).default('30d'),
  })
  .strict();

export const alertQuerySchema = z
  .object({
    range: z.enum(['7d', '30d', '90d']).default('30d'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const traceCorrelationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/u);

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type AlertQuery = z.infer<typeof alertQuerySchema>;
