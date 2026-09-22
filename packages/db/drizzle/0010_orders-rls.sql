-- Tenant isolation for drafts and operational orders.
ALTER TABLE "draft_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "draft_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "draft_orders_isolation" ON "draft_orders"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "draft_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "draft_order_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "draft_order_items_isolation" ON "draft_order_items"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY "orders_select" ON "orders"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "orders_insert" ON "orders"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "orders_update" ON "orders"
  FOR UPDATE
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

-- Historical order children are append-only for the runtime role.
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_items_select" ON "order_items"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "order_items_insert" ON "order_items"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "order_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_commands" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_commands_select" ON "order_commands"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "order_commands_insert" ON "order_commands"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "order_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_transitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "order_transitions_select" ON "order_transitions"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "order_transitions_insert" ON "order_transitions"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

CREATE OR REPLACE FUNCTION app_protect_order_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.source_draft_order_id IS DISTINCT FROM OLD.source_draft_order_id
    OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
    OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
    OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
    OR NEW.shipping_address IS DISTINCT FROM OLD.shipping_address
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.custom_fields IS DISTINCT FROM OLD.custom_fields
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
    OR NEW.shipping_amount IS DISTINCT FROM OLD.shipping_amount
    OR NEW.total IS DISTINCT FROM OLD.total
  THEN
    RAISE EXCEPTION 'confirmed order snapshots are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_protect_snapshot
BEFORE UPDATE ON "orders"
FOR EACH ROW EXECUTE FUNCTION app_protect_order_snapshot();

COMMENT ON TABLE "order_items" IS
  'Immutable product, variant, and price snapshots for confirmed orders.';
COMMENT ON TABLE "order_commands" IS
  'Append-only idempotency log for confirmation, transition, and cancellation commands.';
COMMENT ON TABLE "order_transitions" IS
  'Append-only successful order state transition history.';