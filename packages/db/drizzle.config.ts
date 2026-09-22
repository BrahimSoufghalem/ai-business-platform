import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'postgresql://ai_business:ai_business@localhost:5432/ai_business',
  },
  strict: true,
  verbose: true,
});
