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

Tenant-scoped transactions must call `tenantScopeStatement()` inside the same transaction before running scoped queries. Runtime database roles must not own tables and must not have `BYPASSRLS`.
