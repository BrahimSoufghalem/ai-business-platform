import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

export interface ApiApplicationOptions {
  readonly enableShutdownHooks?: boolean;
}

export async function createApplication(
  options: ApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
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
