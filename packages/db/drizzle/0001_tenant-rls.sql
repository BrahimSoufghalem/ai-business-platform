-- Tenant isolation defense-in-depth.
-- Runtime roles must not own these tables and must not have BYPASSRLS.
CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenants_isolation" ON "tenants"
  USING ("id" = app_current_tenant_id())
  WITH CHECK ("id" = app_current_tenant_id());

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memberships_isolation" ON "memberships"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_events_isolation" ON "audit_events"
  USING ("tenant_id" = app_current_tenant_id())
  WITH CHECK ("tenant_id" = app_current_tenant_id());

COMMENT ON FUNCTION app_current_tenant_id() IS
  'Returns the trusted tenant UUID set locally inside the current transaction.';