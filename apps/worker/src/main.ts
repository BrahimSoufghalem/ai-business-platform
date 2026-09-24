import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from '@ai-business/db';
import { InstagramCredentialVault } from '@ai-business/integrations';
import { PostgresInstagramDeliveryQueue } from './instagram-delivery-queue.js';
import { InstagramDeliveryWorker } from './instagram-delivery-worker.js';

export function workerStatus() {
  return {
    service: 'worker',
    status: 'ready' as const,
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function workerId(): string {
  const configured = process.env.WORKER_ID?.trim();
  if (configured) return configured;
  const host = hostname()
    .replace(/[^A-Za-z0-9._:-]/gu, '-')
    .slice(0, 60);
  return `instagram:${host}:${process.pid}`;
}

export async function startWorker(): Promise<void> {
  const client = createDatabaseClient(requiredEnvironment('DATABASE_URL'));
  const vault = new InstagramCredentialVault(
    requiredEnvironment('INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY'),
    Number.parseInt(process.env.INSTAGRAM_CREDENTIAL_KEY_VERSION ?? '1', 10),
  );
  const worker = new InstagramDeliveryWorker({
    workerId: workerId(),
    queue: new PostgresInstagramDeliveryQueue(client),
    credentialVault: vault,
    appSecret: requiredEnvironment('INSTAGRAM_APP_SECRET'),
  });
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  process.once('SIGTERM', () => abort.abort());

  console.log(JSON.stringify({ ...workerStatus(), workerId: workerId() }));
  try {
    await worker.run(abort.signal, {
      onError: (error) => {
        console.error(
          JSON.stringify({
            service: 'worker',
            event: 'instagram_delivery_error',
            error: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
      },
    });
  } finally {
    await client.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && fileURLToPath(import.meta.url) === resolve(entrypoint)) {
  startWorker().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        service: 'worker',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown worker startup error.',
      }),
    );
    process.exitCode = 1;
  });
}
