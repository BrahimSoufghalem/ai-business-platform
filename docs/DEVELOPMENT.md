# Development

## Requirements

- Node.js 22 or newer
- pnpm 10.34.5
- Docker with Compose

## Local setup

```bash
cp .env.example .env
pnpm install

docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

The API exposes `GET /api/health/live` and `GET /api/health/ready`. The web app runs on the default Next.js development port.

Grounded static, FAQ, price and availability paths can be developed without an external model. To test natural-language discovery or comparison, configure an OpenAI-compatible endpoint through the `AI_PROVIDER_*` variables in `.env.example`; keep the key in a local/managed secret and never commit it.

## Quality commands

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Security rule

A tenant ID may only originate from verified authentication claims or a verified integration credential. Never trust `tenant_id` from a request body, query parameter, arbitrary header, job payload, or AI output. Every background job must carry a validated tenant context and correlation ID.

## Database tenant scope

Tenant-scoped transactions must call `withTenantTransaction()` or `tenantSessionStatement()` inside the same transaction before running scoped queries. The transaction sets the candidate tenant and verified OIDC subject; RLS independently confirms active membership. Runtime database roles must not own tables and must not have `BYPASSRLS`.

## Authentication boundary

The `@ai-business/auth` package validates OIDC tokens through issuer, audience, expiry, signature, and JWKS. Tenant membership does not come from an unchecked request value or ordinary JWT claim; PostgreSQL RLS evaluates it against the memberships table.

Run the database integration gate with:

```bash
DATABASE_URL=postgresql://... TEST_DATABASE_URL=postgresql://... pnpm db:migrate
pnpm --filter @ai-business/db test:integration
pnpm --filter @ai-business/customer-agent test
```
