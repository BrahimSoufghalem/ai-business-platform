-- AI traces are tenant-isolated and append-only. Only redacted payloads belong here.
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_runs_select" ON "ai_runs"
  FOR SELECT USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "ai_runs_insert" ON "ai_runs"
  FOR INSERT WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "ai_tool_calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_tool_calls" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_tool_calls_select" ON "ai_tool_calls"
  FOR SELECT USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "ai_tool_calls_insert" ON "ai_tool_calls"
  FOR INSERT WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

COMMENT ON TABLE "ai_runs" IS
  'Append-only AI gateway runs with provider, model, prompt/routing versions, usage, cost, outcome, and redacted telemetry.';
COMMENT ON COLUMN "ai_runs"."safe_input" IS
  'Bounded redacted input metadata; never raw credentials or direct contact data.';
COMMENT ON COLUMN "ai_runs"."safe_output" IS
  'Bounded redacted result metadata; never raw credentials or direct contact data.';
COMMENT ON TABLE "ai_tool_calls" IS
  'Append-only validated/rejected tool calls with redacted inputs and outputs.';