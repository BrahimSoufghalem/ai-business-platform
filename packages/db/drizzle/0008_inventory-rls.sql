-- Membership-aware isolation for inventory locations, projections, ledger, and reservations.
ALTER TABLE "inventory_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_locations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_locations_isolation" ON "inventory_locations"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "inventory_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_balances" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_balances_isolation" ON "inventory_balances"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "stock_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_reservations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "stock_reservations_isolation" ON "stock_reservations"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "inventory_movements_select" ON "inventory_movements"
  FOR SELECT
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );
CREATE POLICY "inventory_movements_insert" ON "inventory_movements"
  FOR INSERT
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

COMMENT ON TABLE "inventory_movements" IS
  'Append-only inventory ledger. Balances are transactionally maintained projections.';
COMMENT ON TABLE "inventory_balances" IS
  'Atomic stock projection where available equals on_hand minus reserved.';
COMMENT ON COLUMN "inventory_movements"."idempotency_key" IS
  'Tenant-unique key that makes inventory commands safe to retry.';