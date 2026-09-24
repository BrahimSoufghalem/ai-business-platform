import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InstagramConnectionController } from './instagram-connection.controller.js';
import { InstagramConnectionService } from './instagram-connection.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [InstagramConnectionController],
  providers: [InstagramConnectionService],
  exports: [InstagramConnectionService],
})
export class IntegrationsModule {}
