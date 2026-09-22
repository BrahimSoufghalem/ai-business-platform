CREATE TYPE "public"."draft_order_status" AS ENUM('draft', 'awaiting_confirmation', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_command_type" AS ENUM('confirm', 'transition', 'cancel');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "draft_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"draft_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"product_code_snapshot" text NOT NULL,
	"variant_name_snapshot" text,
	"sku_snapshot" text NOT NULL,
	"variant_attributes_snapshot" jsonb NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_order_items_quantity_positive" CHECK ("draft_order_items"."quantity" > 0),
	CONSTRAINT "draft_order_items_unit_price_nonnegative" CHECK ("draft_order_items"."unit_price" >= 0),
	CONSTRAINT "draft_order_items_line_total_consistent" CHECK ("draft_order_items"."line_total" = "draft_order_items"."unit_price" * "draft_order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "draft_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "draft_order_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"shipping_address" jsonb,
	"notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currency" text DEFAULT 'DZD' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"shipping_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"submitted_at" timestamp with time zone,
	"customer_approved_at" timestamp with time zone,
	"approval_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_orders_version_positive" CHECK ("draft_orders"."version" > 0),
	CONSTRAINT "draft_orders_subtotal_nonnegative" CHECK ("draft_orders"."subtotal" >= 0),
	CONSTRAINT "draft_orders_discount_nonnegative" CHECK ("draft_orders"."discount_amount" >= 0),
	CONSTRAINT "draft_orders_shipping_nonnegative" CHECK ("draft_orders"."shipping_amount" >= 0),
	CONSTRAINT "draft_orders_total_nonnegative" CHECK ("draft_orders"."total" >= 0),
	CONSTRAINT "draft_orders_total_consistent" CHECK ("draft_orders"."total" = "draft_orders"."subtotal" - "draft_orders"."discount_amount" + "draft_orders"."shipping_amount")
);
--> statement-breakpoint
CREATE TABLE "order_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"draft_order_id" uuid,
	"type" "order_command_type" NOT NULL,
	"idempotency_key" text NOT NULL,
	"command_fingerprint" text NOT NULL,
	"result_status" "order_status" NOT NULL,
	"actor_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"product_code_snapshot" text NOT NULL,
	"variant_name_snapshot" text,
	"sku_snapshot" text NOT NULL,
	"variant_attributes_snapshot" jsonb NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_nonnegative" CHECK ("order_items"."unit_price" >= 0),
	CONSTRAINT "order_items_line_total_consistent" CHECK ("order_items"."line_total" = "order_items"."unit_price" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "order_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"idempotency_key" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_draft_order_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "order_status" DEFAULT 'new' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text,
	"shipping_address" jsonb NOT NULL,
	"notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"currency" text NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"discount_amount" numeric(14, 2) NOT NULL,
	"shipping_amount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"confirmed_at" timestamp with time zone,
	"preparing_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_version_positive" CHECK ("orders"."version" > 0),
	CONSTRAINT "orders_subtotal_nonnegative" CHECK ("orders"."subtotal" >= 0),
	CONSTRAINT "orders_discount_nonnegative" CHECK ("orders"."discount_amount" >= 0),
	CONSTRAINT "orders_shipping_nonnegative" CHECK ("orders"."shipping_amount" >= 0),
	CONSTRAINT "orders_total_nonnegative" CHECK ("orders"."total" >= 0),
	CONSTRAINT "orders_total_consistent" CHECK ("orders"."total" = "orders"."subtotal" - "orders"."discount_amount" + "orders"."shipping_amount")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "draft_orders_tenant_id_id_uq" ON "draft_orders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_id_id_uq" ON "orders" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "draft_order_items" ADD CONSTRAINT "draft_order_items_tenant_draft_fk" FOREIGN KEY ("tenant_id","draft_order_id") REFERENCES "public"."draft_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_order_items" ADD CONSTRAINT "draft_order_items_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_order_items" ADD CONSTRAINT "draft_order_items_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_order_items" ADD CONSTRAINT "draft_order_items_tenant_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."inventory_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_commands" ADD CONSTRAINT "order_commands_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_commands" ADD CONSTRAINT "order_commands_tenant_draft_fk" FOREIGN KEY ("tenant_id","draft_order_id") REFERENCES "public"."draft_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."inventory_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."stock_reservations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_transitions" ADD CONSTRAINT "order_transitions_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_source_draft_fk" FOREIGN KEY ("tenant_id","source_draft_order_id") REFERENCES "public"."draft_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_order_items_draft_variant_location_uq" ON "draft_order_items" USING btree ("draft_order_id","variant_id","location_id");--> statement-breakpoint
CREATE INDEX "draft_order_items_tenant_draft_idx" ON "draft_order_items" USING btree ("tenant_id","draft_order_id");--> statement-breakpoint
CREATE INDEX "draft_orders_tenant_status_idx" ON "draft_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "order_commands_tenant_idempotency_uq" ON "order_commands" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "order_commands_tenant_order_idx" ON "order_commands" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_tenant_id_id_uq" ON "order_items" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "order_items_tenant_order_idx" ON "order_items" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "order_transitions_tenant_order_created_idx" ON "order_transitions" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_number_uq" ON "orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_source_draft_uq" ON "orders" USING btree ("tenant_id","source_draft_order_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_status_created_idx" ON "orders" USING btree ("tenant_id","status","created_at");