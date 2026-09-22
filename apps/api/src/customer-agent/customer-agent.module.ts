import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { ConversationModule } from '../conversations/conversation.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ProductsModule } from '../products/products.module.js';
import { CustomerAgentController } from './customer-agent.controller.js';
import { CustomerAgentService } from './customer-agent.service.js';

@Module({
  imports: [ConversationModule, ProductsModule, InventoryModule, ConfigurationModule],
  controllers: [CustomerAgentController],
  providers: [CustomerAgentService],
})
export class CustomerAgentModule {}
