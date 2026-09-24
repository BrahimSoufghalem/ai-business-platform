CREATE OR REPLACE FUNCTION app_resolve_instagram_tenant(target_account_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT account.tenant_id
  FROM instagram_accounts AS account
  WHERE target_account_id ~ '^[0-9]{1,80}$'
    AND account.instagram_account_id = target_account_id
    AND account.status = 'active'
  LIMIT 1
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_resolve_instagram_tenant(text) FROM PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_business_runtime') THEN
    GRANT EXECUTE ON FUNCTION app_resolve_instagram_tenant(text) TO ai_business_runtime;
  END IF;
END
$$;--> statement-breakpoint

COMMENT ON FUNCTION app_resolve_instagram_tenant(text) IS
  'Resolves a signed Instagram webhook account ID to its tenant without exposing credentials.';