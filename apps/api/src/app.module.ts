import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ConfigurationModule } from './configuration/configuration.module.js';
import { ConversationModule } from './conversations/conversation.module.js';
import { CustomerModule } from './customers/customer.module.js';
import { CustomerAgentModule } from './customer-agent/customer-agent.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { OrderModule } from './orders/order.module.js';
import { ProductsModule } from './products/products.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TenantModule } from './tenants/tenant.module.js';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    StorageModule,
    TenantModule,
    CatalogModule,
    ProductsModule,
    InventoryModule,
    OrderModule,
    CustomerModule,
    ConversationModule,
    ConfigurationModule,
    CustomerAgentModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
