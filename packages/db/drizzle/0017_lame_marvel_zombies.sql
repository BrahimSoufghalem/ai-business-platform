ALTER TABLE "draft_order_items" ADD COLUMN "list_price" numeric(14, 2);--> statement-breakpoint
UPDATE "draft_order_items" SET "list_price" = "unit_price" WHERE "list_price" IS NULL;--> statement-breakpoint
ALTER TABLE "draft_order_items" ALTER COLUMN "list_price" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_order_items" ADD COLUMN "pricing_decision_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "list_price" numeric(14, 2);--> statement-breakpoint
UPDATE "order_items" SET "list_price" = "unit_price" WHERE "list_price" IS NULL;--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "list_price" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "pricing_decision_id" uuid;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_order_items" ADD CONSTRAINT "draft_order_items_tenant_pricing_decision_fk" FOREIGN KEY ("tenant_id","pricing_decision_id") REFERENCES "public"."pricing_decisions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_pricing_decision_fk" FOREIGN KEY ("tenant_id","pricing_decision_id") REFERENCES "public"."pricing_decisions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pricing_decisions_tenant_variant_created_idx" ON "pricing_decisions" USING btree ("tenant_id","variant_id","created_at");--> statement-breakpoint
ALTER TABLE "draft_order_items" ADD CONSTRAINT "draft_order_items_list_price_nonnegative" CHECK ("draft_order_items"."list_price" >= 0);--> statement-breakpoint
ALTER TABLE "draft_order_items" ADD CONSTRAINT "draft_order_items_unit_price_not_above_list" CHECK ("draft_order_items"."unit_price" <= "draft_order_items"."list_price");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_list_price_nonnegative" CHECK ("order_items"."list_price" >= 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_unit_price_not_above_list" CHECK ("order_items"."unit_price" <= "order_items"."list_price");--> statement-breakpoint

-- A discounted line must be backed by the exact immutable pricing decision and
-- the referenced rule version must still be published when the line is written.
CREATE OR REPLACE FUNCTION app_validate_order_item_pricing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.pricing_decision_id IS NULL THEN
    IF NEW.unit_price IS DISTINCT FROM NEW.list_price THEN
      RAISE EXCEPTION 'discounted order item requires a pricing decision'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pricing_decisions AS decision
    JOIN business_rule_versions AS version
      ON version.tenant_id = decision.tenant_id
      AND version.rule_set_id = decision.rule_set_id
      AND version.id = decision.rule_version_id
    WHERE decision.tenant_id = NEW.tenant_id
      AND decision.id = NEW.pricing_decision_id
      AND decision.product_id = NEW.product_id
      AND decision.variant_id = NEW.variant_id
      AND decision.currency = NEW.currency
      AND decision.list_price = NEW.list_price
      AND decision.decided_price = NEW.unit_price
      AND decision.outcome IN ('accept', 'counter')
      AND version.status = 'published'
  ) THEN
    RAISE EXCEPTION 'order item pricing decision does not match its line'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER draft_order_items_validate_pricing
BEFORE INSERT OR UPDATE OF
  tenant_id, product_id, variant_id, currency, list_price, unit_price, pricing_decision_id
ON "draft_order_items"
FOR EACH ROW EXECUTE FUNCTION app_validate_order_item_pricing();

CREATE TRIGGER order_items_validate_pricing
BEFORE INSERT OR UPDATE OF
  tenant_id, product_id, variant_id, currency, list_price, unit_price, pricing_decision_id
ON "order_items"
FOR EACH ROW EXECUTE FUNCTION app_validate_order_item_pricing();

COMMENT ON COLUMN "draft_order_items"."list_price" IS
  'Catalog price snapshot before any policy-backed negotiation discount.';
COMMENT ON COLUMN "draft_order_items"."pricing_decision_id" IS
  'Exact persisted pricing decision authorizing a negotiated unit price.';
COMMENT ON COLUMN "order_items"."list_price" IS
  'Immutable catalog price snapshot copied from the confirmed draft.';
COMMENT ON COLUMN "order_items"."pricing_decision_id" IS
  'Exact persisted pricing decision copied from the confirmed draft.';
