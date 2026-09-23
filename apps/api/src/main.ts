import { createApplication } from './application.js';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
