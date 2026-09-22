import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { TenantModule } from './tenants/tenant.module.js';

@Module({
  imports: [AuthModule, DatabaseModule, TenantModule, CatalogModule],
  controllers: [HealthController],
})
export class AppModule {}
