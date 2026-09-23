import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../src/application.js';

interface ServerlessRuntime {
  readonly app: NestFastifyApplication;
  readonly server: Server;
}

let runtimePromise: Promise<ServerlessRuntime> | undefined;

async function createRuntime(): Promise<ServerlessRuntime> {
  const app = await createApplication({ enableShutdownHooks: false });
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return { app, server: fastify.server };
}

async function runtime(): Promise<ServerlessRuntime> {
  runtimePromise ??= createRuntime().catch((error: unknown) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const { server } = await runtime();
  server.emit('request', request, response);
}
