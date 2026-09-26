import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InstagramConnectionController } from './instagram-connection.controller.js';
import {
  INSTAGRAM_CREDENTIAL_VALIDATOR,
  INSTAGRAM_WEBHOOK_SUBSCRIBER,
  InstagramConnectionService,
} from './instagram-connection.service.js';
import { InstagramWebhookController } from './instagram-webhook.controller.js';
import { InstagramWebhookService } from './instagram-webhook.service.js';
import {
  subscribeInstagramAccountWebhooks,
  validateInstagramCredentials,
} from '@ai-business/integrations';

@Module({
  imports: [DatabaseModule],
  controllers: [InstagramConnectionController, InstagramWebhookController],
  providers: [
    InstagramConnectionService,
    InstagramWebhookService,
    { provide: INSTAGRAM_CREDENTIAL_VALIDATOR, useValue: validateInstagramCredentials },
    { provide: INSTAGRAM_WEBHOOK_SUBSCRIBER, useValue: subscribeInstagramAccountWebhooks },
  ],
  exports: [InstagramConnectionService],
})
export class IntegrationsModule {}
