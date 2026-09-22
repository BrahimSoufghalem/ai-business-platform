import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
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
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
