-- Tenant isolation defense-in-depth.
-- Runtime roles must not own these tables and must not have BYPASSRLS.
CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_identity_subject()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.identity_subject', true), '')
$$;

-- SECURITY DEFINER avoids recursive RLS while checking membership. The function
-- exposes only a boolean and fixes search_path to prevent object substitution.
CREATE OR REPLACE FUNCTION app_has_active_tenant_membership(target_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships AS membership
    INNER JOIN app_users AS app_user ON app_user.id = membership.user_id
    WHERE membership.tenant_id = target_tenant_id
      AND membership.status = 'active'
      AND app_user.identity_provider_id = app_current_identity_subject()
  )
$$;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenants_isolation" ON "tenants"
  USING (
    "id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("id")
  )
  WITH CHECK (
    "id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("id")
  );

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memberships_isolation" ON "memberships"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_events_isolation" ON "audit_events"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

COMMENT ON FUNCTION app_current_tenant_id() IS
  'Returns the candidate tenant UUID set locally inside the current transaction.';
COMMENT ON FUNCTION app_current_identity_subject() IS
  'Returns the verified OIDC subject set locally inside the current transaction.';
COMMENT ON FUNCTION app_has_active_tenant_membership(uuid) IS
  'Checks that the verified identity is an active member of the candidate tenant.';
