import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import { CorrelationId, CurrentIdentity } from '../auth/request-context.decorator.js';
import { parseWithSchema } from '../products/http-validation.js';
import { tenantIdSchema } from '../tenants/tenant.schemas.js';
import { AgentSettingsService } from './agent-settings.service.js';
import { BusinessRuleService } from './business-rule.service.js';
import {
  configurationEntityIdSchema,
  createKnowledgeEntrySchema,
  createRuleSetSchema,
  evaluatePriceSchema,
  knowledgeSearchSchema,
  listConfigurationSchema,
  publishAgentSettingsSchema,
  publishKnowledgeVersionSchema,
  publishRuleVersionSchema,
  saveAgentSettingsDraftSchema,
  saveKnowledgeDraftSchema,
  saveRuleDraftSchema,
} from './configuration.schemas.js';
import { KnowledgeService } from './knowledge.service.js';

function tenantId(value: string): string {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid tenant UUID is required.');
  return parsed.data;
}

function entityId(value: string): string {
  const parsed = configurationEntityIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('A valid entity UUID is required.');
  return parsed.data;
}

@Controller('tenants/:tenantId')
export class ConfigurationController {
  constructor(
    @Inject(BusinessRuleService) private readonly rules: BusinessRuleService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(AgentSettingsService) private readonly agentSettings: AgentSettingsService,
  ) {}

  @Get('rule-sets')
  listRuleSets(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.rules.list(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(listConfigurationSchema, query),
    );
  }

  @Post('rule-sets')
  createRuleSet(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.rules.create(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(createRuleSetSchema, body),
    );
  }

  @Get('rule-sets/:ruleSetId')
  getRuleSet(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('ruleSetId') candidateRuleSetId: string,
  ) {
    return this.rules.get(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateRuleSetId),
    );
  }

  @Put('rule-sets/:ruleSetId/draft')
  saveRuleDraft(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('ruleSetId') candidateRuleSetId: string,
    @Body() body: unknown,
  ) {
    return this.rules.saveDraft(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateRuleSetId),
      parseWithSchema(saveRuleDraftSchema, body),
    );
  }

  @Post('rule-sets/:ruleSetId/versions/:versionId/publish')
  publishRuleVersion(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('ruleSetId') candidateRuleSetId: string,
    @Param('versionId') candidateVersionId: string,
    @Body() body: unknown,
  ) {
    return this.rules.publish(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateRuleSetId),
      entityId(candidateVersionId),
      parseWithSchema(publishRuleVersionSchema, body),
    );
  }

  @Post('rule-sets/:ruleSetId/evaluate-price')
  evaluatePrice(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('ruleSetId') candidateRuleSetId: string,
    @Body() body: unknown,
  ) {
    return this.rules.evaluate(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateRuleSetId),
      parseWithSchema(evaluatePriceSchema, body),
    );
  }

  @Get('knowledge/search')
  searchKnowledge(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.knowledge.searchPublished(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(knowledgeSearchSchema, query),
    );
  }

  @Get('knowledge')
  listKnowledge(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Query() query: unknown,
  ) {
    return this.knowledge.list(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(listConfigurationSchema, query),
    );
  }

  @Post('knowledge')
  createKnowledge(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.knowledge.create(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(createKnowledgeEntrySchema, body),
    );
  }

  @Get('knowledge/:entryId')
  getKnowledge(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('entryId') candidateEntryId: string,
  ) {
    return this.knowledge.get(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateEntryId),
    );
  }

  @Put('knowledge/:entryId/draft')
  saveKnowledgeDraft(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('entryId') candidateEntryId: string,
    @Body() body: unknown,
  ) {
    return this.knowledge.saveDraft(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateEntryId),
      parseWithSchema(saveKnowledgeDraftSchema, body),
    );
  }

  @Post('knowledge/:entryId/versions/:versionId/publish')
  publishKnowledgeVersion(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('entryId') candidateEntryId: string,
    @Param('versionId') candidateVersionId: string,
    @Body() body: unknown,
  ) {
    return this.knowledge.publish(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateEntryId),
      entityId(candidateVersionId),
      parseWithSchema(publishKnowledgeVersionSchema, body),
    );
  }

  @Get('agent-settings')
  getAgentSettingsHistory(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
  ) {
    return this.agentSettings.history(identity, correlationId, tenantId(candidateTenantId));
  }

  @Get('agent-settings/published')
  getPublishedAgentSettings(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
  ) {
    return this.agentSettings.published(identity, correlationId, tenantId(candidateTenantId));
  }

  @Put('agent-settings/draft')
  saveAgentSettingsDraft(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Body() body: unknown,
  ) {
    return this.agentSettings.saveDraft(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      parseWithSchema(saveAgentSettingsDraftSchema, body),
    );
  }

  @Post('agent-settings/versions/:versionId/publish')
  publishAgentSettings(
    @CurrentIdentity() identity: VerifiedIdentity,
    @CorrelationId() correlationId: string,
    @Param('tenantId') candidateTenantId: string,
    @Param('versionId') candidateVersionId: string,
    @Body() body: unknown,
  ) {
    return this.agentSettings.publish(
      identity,
      correlationId,
      tenantId(candidateTenantId),
      entityId(candidateVersionId),
      parseWithSchema(publishAgentSettingsSchema, body),
    );
  }
}
