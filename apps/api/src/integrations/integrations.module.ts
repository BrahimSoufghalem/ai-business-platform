import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InstagramConnectionController } from './instagram-connection.controller.js';
import {
  INSTAGRAM_CREDENTIAL_VALIDATOR,
  InstagramConnectionService,
} from './instagram-connection.service.js';
import { InstagramWebhookController } from './instagram-webhook.controller.js';
import { InstagramWebhookService } from './instagram-webhook.service.js';
import { validateInstagramCredentials } from '@ai-business/integrations';

@Module({
  imports: [DatabaseModule],
  controllers: [InstagramConnectionController, InstagramWebhookController],
  providers: [
    InstagramConnectionService,
    InstagramWebhookService,
    { provide: INSTAGRAM_CREDENTIAL_VALIDATOR, useValue: validateInstagramCredentials },
  ],
  exports: [InstagramConnectionService],
})
export class IntegrationsModule {}
