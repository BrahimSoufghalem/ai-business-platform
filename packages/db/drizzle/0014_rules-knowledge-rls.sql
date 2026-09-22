-- Tenant isolation for versioned business configuration and knowledge.
ALTER TABLE "business_rule_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_rule_sets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "business_rule_sets_isolation" ON "business_rule_sets"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "business_rule_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_rule_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "business_rule_versions_select" ON "business_rule_versions"
  FOR SELECT USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "business_rule_versions_insert" ON "business_rule_versions"
  FOR INSERT WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "business_rule_versions_update" ON "business_rule_versions"
  FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "knowledge_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_entries_isolation" ON "knowledge_entries"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "knowledge_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_versions_select" ON "knowledge_versions"
  FOR SELECT USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "knowledge_versions_insert" ON "knowledge_versions"
  FOR INSERT WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "knowledge_versions_update" ON "knowledge_versions"
  FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "agent_settings_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_settings_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agent_settings_versions_select" ON "agent_settings_versions"
  FOR SELECT USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "agent_settings_versions_insert" ON "agent_settings_versions"
  FOR INSERT WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "agent_settings_versions_update" ON "agent_settings_versions"
  FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

-- Pricing decisions are append-only and always reference a published version.
ALTER TABLE "pricing_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pricing_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pricing_decisions_select" ON "pricing_decisions"
  FOR SELECT USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "pricing_decisions_insert" ON "pricing_decisions"
  FOR INSERT WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

CREATE OR REPLACE FUNCTION app_protect_business_rule_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.policy IS DISTINCT FROM OLD.policy
    OR NEW.change_note IS DISTINCT FROM OLD.change_note
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'business rule version content is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'superseded'
    OR (OLD.status = 'draft' AND NEW.status NOT IN ('published', 'superseded'))
    OR (OLD.status = 'published' AND NEW.status <> 'superseded')
  THEN
    RAISE EXCEPTION 'invalid business rule version transition'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'published'
    AND (NEW.published_at IS NULL OR NEW.published_by IS NULL)
  THEN
    RAISE EXCEPTION 'published business rule requires attribution'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_rule_versions_protect
BEFORE UPDATE ON "business_rule_versions"
FOR EACH ROW EXECUTE FUNCTION app_protect_business_rule_version();

CREATE OR REPLACE FUNCTION app_protect_knowledge_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.entry_id IS DISTINCT FROM OLD.entry_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.question IS DISTINCT FROM OLD.question
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.change_note IS DISTINCT FROM OLD.change_note
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'knowledge version content is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'superseded'
    OR (OLD.status = 'draft' AND NEW.status NOT IN ('published', 'superseded'))
    OR (OLD.status = 'published' AND NEW.status <> 'superseded')
  THEN
    RAISE EXCEPTION 'invalid knowledge version transition'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'published'
    AND (NEW.published_at IS NULL OR NEW.published_by IS NULL)
  THEN
    RAISE EXCEPTION 'published knowledge requires attribution'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_versions_protect
BEFORE UPDATE ON "knowledge_versions"
FOR EACH ROW EXECUTE FUNCTION app_protect_knowledge_version();

CREATE OR REPLACE FUNCTION app_protect_agent_settings_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.language IS DISTINCT FROM OLD.language
    OR NEW.tone IS DISTINCT FROM OLD.tone
    OR NEW.handoff_notes IS DISTINCT FROM OLD.handoff_notes
    OR NEW.change_note IS DISTINCT FROM OLD.change_note
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'agent settings version content is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'superseded'
    OR (OLD.status = 'draft' AND NEW.status NOT IN ('published', 'superseded'))
    OR (OLD.status = 'published' AND NEW.status <> 'superseded')
  THEN
    RAISE EXCEPTION 'invalid agent settings version transition'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'published'
    AND (NEW.published_at IS NULL OR NEW.published_by IS NULL)
  THEN
    RAISE EXCEPTION 'published agent settings require attribution'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_settings_versions_protect
BEFORE UPDATE ON "agent_settings_versions"
FOR EACH ROW EXECUTE FUNCTION app_protect_agent_settings_version();

CREATE OR REPLACE FUNCTION app_require_published_pricing_rule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM business_rule_versions AS rule_version
    WHERE rule_version.tenant_id = NEW.tenant_id
      AND rule_version.rule_set_id = NEW.rule_set_id
      AND rule_version.id = NEW.rule_version_id
      AND rule_version.version = NEW.rule_version
      AND rule_version.status = 'published'
  ) THEN
    RAISE EXCEPTION 'pricing decision requires a currently published rule version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pricing_decisions_require_published_rule
BEFORE INSERT ON "pricing_decisions"
FOR EACH ROW EXECUTE FUNCTION app_require_published_pricing_rule();

COMMENT ON TABLE "business_rule_versions" IS
  'Immutable typed pricing policy versions with one draft and one published version per set.';
COMMENT ON TABLE "knowledge_versions" IS
  'Immutable knowledge content versions; only published rows are available to agent retrieval.';
COMMENT ON TABLE "agent_settings_versions" IS
  'Allow-listed language, tone, and handoff-note versions; no executable prompt configuration.';
COMMENT ON TABLE "pricing_decisions" IS
  'Append-only price decisions tied to an exact published business rule version.';