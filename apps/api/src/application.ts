import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { registerInstagramWebhookSecurity } from './integrations/instagram-webhook-preparser.js';

export interface ApiApplicationOptions {
  readonly enableShutdownHooks?: boolean;
}

export async function createApplication(
  options: ApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: false,
    bodyLimit: 1_048_576,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    rawBody: true,
  });
  registerInstagramWebhookSecurity(adapter.getInstance());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',').map((origin) => origin.trim()) ?? [
      'http://localhost:3000',
    ],
    credentials: false,
  });
  if (options.enableShutdownHooks !== false) app.enableShutdownHooks();
  return app;
}
