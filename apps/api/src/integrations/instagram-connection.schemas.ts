import { z } from 'zod';

export const connectInstagramAccountSchema = z
  .object({
    accountId: z
      .string()
      .trim()
      .regex(/^[0-9]{1,80}$/u),
    accessToken: z
      .string()
      .min(10)
      .max(8_192)
      .refine((value) => value.trim() === value, 'Access token must not contain outer whitespace.'),
  })
  .strict();

export type ConnectInstagramAccountInput = z.infer<typeof connectInstagramAccountSchema>;
