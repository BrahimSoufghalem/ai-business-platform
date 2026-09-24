import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InstagramConnectionController } from './instagram-connection.controller.js';
import { InstagramConnectionService } from './instagram-connection.service.js';
import { InstagramWebhookController } from './instagram-webhook.controller.js';
import { InstagramWebhookService } from './instagram-webhook.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [InstagramConnectionController, InstagramWebhookController],
  providers: [InstagramConnectionService, InstagramWebhookService],
  exports: [InstagramConnectionService],
})
export class IntegrationsModule {}
