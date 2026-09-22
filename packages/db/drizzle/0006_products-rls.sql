-- Membership-aware isolation for sellable catalog records and content mappings.
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY "products_isolation" ON "products"
  USING ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"))
  WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"));

ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "product_variants_isolation" ON "product_variants"
  USING ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"))
  WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"));

ALTER TABLE "product_media" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_media" FORCE ROW LEVEL SECURITY;
CREATE POLICY "product_media_isolation" ON "product_media"
  USING ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"))
  WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"));

ALTER TABLE "content_product_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_product_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "content_product_links_isolation" ON "content_product_links"
  USING ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"))
  WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"));

ALTER TABLE "product_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_revisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "product_revisions_isolation" ON "product_revisions"
  USING ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"))
  WITH CHECK ("tenant_id" = app_current_tenant_id() AND app_has_active_tenant_membership("tenant_id"));

COMMENT ON TABLE "product_revisions" IS
  'Immutable product and variant snapshots captured at every catalog version.';