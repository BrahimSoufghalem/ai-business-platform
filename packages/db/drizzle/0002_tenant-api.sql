-- Safe cross-tenant operations for an authenticated identity.
-- These SECURITY DEFINER functions expose narrow business operations only.
CREATE OR REPLACE FUNCTION app_list_current_identity_memberships()
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  membership_role text,
  membership_status text,
  membership_created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT
    tenant.id,
    tenant.name,
    membership.role::text,
    membership.status::text,
    membership.created_at
  FROM memberships AS membership
  INNER JOIN app_users AS app_user ON app_user.id = membership.user_id
  INNER JOIN tenants AS tenant ON tenant.id = membership.tenant_id
  WHERE app_user.identity_provider_id = app_current_identity_subject()
    AND membership.status = 'active'
    AND tenant.status = 'active'
  ORDER BY membership.created_at DESC
$$;

CREATE OR REPLACE FUNCTION app_current_membership_role(target_tenant_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT membership.role::text
  FROM memberships AS membership
  INNER JOIN app_users AS app_user ON app_user.id = membership.user_id
  WHERE membership.tenant_id = target_tenant_id
    AND membership.status = 'active'
    AND app_user.identity_provider_id = app_current_identity_subject()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_provision_tenant(
  tenant_name text,
  identity_email text,
  tenant_locale text,
  tenant_timezone text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  identity_subject text;
  resolved_user_id uuid;
  provisioned_tenant_id uuid;
BEGIN
  identity_subject := app_current_identity_subject();

  IF identity_subject IS NULL THEN
    RAISE EXCEPTION 'Verified identity subject is required' USING ERRCODE = '28000';
  END IF;

  IF char_length(btrim(tenant_name)) < 2 OR char_length(btrim(tenant_name)) > 120 THEN
    RAISE EXCEPTION 'Tenant name must contain between 2 and 120 characters' USING ERRCODE = '22023';
  END IF;

  IF char_length(tenant_locale) < 2 OR char_length(tenant_locale) > 16 THEN
    RAISE EXCEPTION 'Invalid tenant locale' USING ERRCODE = '22023';
  END IF;

  IF char_length(tenant_timezone) < 1 OR char_length(tenant_timezone) > 64 THEN
    RAISE EXCEPTION 'Invalid tenant timezone' USING ERRCODE = '22023';
  END IF;

  INSERT INTO app_users (identity_provider_id, email)
  VALUES (identity_subject, NULLIF(btrim(identity_email), ''))
  ON CONFLICT (identity_provider_id) DO UPDATE
    SET email = COALESCE(EXCLUDED.email, app_users.email)
  RETURNING id INTO resolved_user_id;

  INSERT INTO tenants (name, locale, timezone)
  VALUES (btrim(tenant_name), tenant_locale, tenant_timezone)
  RETURNING id INTO provisioned_tenant_id;

  INSERT INTO memberships (tenant_id, user_id, role, status)
  VALUES (provisioned_tenant_id, resolved_user_id, 'owner', 'active');

  INSERT INTO audit_events (
    tenant_id, actor_type, actor_id, action, entity_type, entity_id,
    correlation_id, metadata
  )
  VALUES (
    provisioned_tenant_id,
    'user',
    identity_subject,
    'tenant.provisioned',
    'tenant',
    provisioned_tenant_id::text,
    COALESCE(NULLIF(current_setting('app.correlation_id', true), ''), 'unknown'),
    jsonb_build_object('source', 'tenant_api')
  );

  RETURN provisioned_tenant_id;
END
$$;

COMMENT ON FUNCTION app_list_current_identity_memberships() IS
  'Lists active tenants for the verified OIDC subject in the current transaction.';
COMMENT ON FUNCTION app_current_membership_role(uuid) IS
  'Returns the active membership role for the verified identity and target tenant.';
COMMENT ON FUNCTION app_provision_tenant(text, text, text, text) IS
  'Atomically provisions a tenant, owner membership, and audit event.';
