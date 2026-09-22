import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AgentSettingsService } from './agent-settings.service.js';
import { BusinessRuleService } from './business-rule.service.js';
import { ConfigurationController } from './configuration.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ConfigurationController],
  providers: [BusinessRuleService, KnowledgeService, AgentSettingsService],
  exports: [BusinessRuleService, KnowledgeService, AgentSettingsService],
})
export class ConfigurationModule {}
