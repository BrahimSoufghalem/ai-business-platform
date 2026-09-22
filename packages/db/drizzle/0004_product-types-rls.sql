-- Membership-aware tenant isolation for configurable catalog schemas.
ALTER TABLE "product_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_types" FORCE ROW LEVEL SECURITY;
CREATE POLICY "product_types_isolation" ON "product_types"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

ALTER TABLE "attribute_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attribute_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "attribute_definitions_isolation" ON "attribute_definitions"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );

COMMENT ON TABLE "product_types" IS
  'Tenant-owned configurable product schemas with optimistic schema versions.';
COMMENT ON TABLE "attribute_definitions" IS
  'Validated dynamic attributes belonging to exactly one tenant and product type.';