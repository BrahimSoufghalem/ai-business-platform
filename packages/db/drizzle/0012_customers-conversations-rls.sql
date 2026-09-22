-- Tenant isolation for customer profiles and the internal conversation inbox.
CREATE OR REPLACE FUNCTION app_current_membership_user_id(target_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT membership.user_id
  FROM memberships AS membership
  INNER JOIN app_users AS app_user ON app_user.id = membership.user_id
  WHERE membership.tenant_id = target_tenant_id
    AND membership.status = 'active'
    AND app_user.identity_provider_id = app_current_identity_subject()
  LIMIT 1
$$;

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "customers_isolation" ON "customers"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "customer_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "customer_contacts_isolation" ON "customer_contacts"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_addresses" FORCE ROW LEVEL SECURITY;
CREATE POLICY "customer_addresses_isolation" ON "customer_addresses"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

-- Notes are append-only for the runtime role.
ALTER TABLE "customer_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "customer_notes_select" ON "customer_notes"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "customer_notes_insert" ON "customer_notes"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "conversations_isolation" ON "conversations"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

-- Message bodies and transition history are append-only for the runtime role.
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "messages_select" ON "messages"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "messages_insert" ON "messages"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "conversation_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_transitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "conversation_transitions_select" ON "conversation_transitions"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "conversation_transitions_insert" ON "conversation_transitions"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

COMMENT ON TABLE "customer_contacts" IS
  'Tenant-scoped contact values with normalized keys for deterministic deduplication.';
COMMENT ON TABLE "messages" IS
  'Append-only conversation messages; external IDs are idempotent within a conversation.';
COMMENT ON TABLE "conversation_transitions" IS
  'Append-only successful conversation status transition history.';
COMMENT ON FUNCTION app_current_membership_user_id(uuid) IS
  'Returns the active tenant membership user ID for the verified identity.';

CREATE OR REPLACE FUNCTION app_protect_order_customer_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'confirmed order customer link is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_protect_customer_link
BEFORE UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION app_protect_order_customer_link();