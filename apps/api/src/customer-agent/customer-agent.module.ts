import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module.js';
import { ConversationModule } from '../conversations/conversation.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { OrderModule } from '../orders/order.module.js';
import { ProductsModule } from '../products/products.module.js';
import { CustomerAgentController } from './customer-agent.controller.js';
import { CustomerAgentJobController } from './customer-agent-job.controller.js';
import { CustomerAgentJobProcessorService } from './customer-agent-job-processor.service.js';
import { CustomerAgentService } from './customer-agent.service.js';

@Module({
  imports: [ConversationModule, ProductsModule, InventoryModule, OrderModule, ConfigurationModule],
  controllers: [CustomerAgentController, CustomerAgentJobController],
  providers: [CustomerAgentService, CustomerAgentJobProcessorService],
})
export class CustomerAgentModule {}
