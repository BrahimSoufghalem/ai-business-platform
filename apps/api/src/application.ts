import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { registerInstagramWebhookSecurity } from './integrations/instagram-webhook-preparser.js';

export interface ApiApplicationOptions {
  readonly enableShutdownHooks?: boolean;
}

const CORS_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const CORS_HEADERS = ['Authorization', 'Content-Type', 'X-Correlation-Id'] as const;

function webOrigins(): string[] {
  const configured = process.env.WEB_ORIGIN?.split(',')
    .map((origin) => origin.trim().replace(/\/+$/u, ''))
    .filter(Boolean);
  return configured && configured.length > 0 ? configured : ['http://localhost:3000'];
}

export async function createApplication(
  options: ApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: false,
    bodyLimit: 8 * 1_048_576,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    rawBody: true,
  });
  registerInstagramWebhookSecurity(adapter.getInstance());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: webOrigins(),
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_HEADERS],
    exposedHeaders: ['X-Correlation-Id'],
    maxAge: 86_400,
    credentials: false,
  });
  if (options.enableShutdownHooks !== false) app.enableShutdownHooks();
  return app;
}
