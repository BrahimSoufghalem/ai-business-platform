CREATE TYPE "public"."inventory_location_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_type" AS ENUM('receive', 'adjust', 'reserve', 'release', 'sell', 'return');--> statement-breakpoint
CREATE TYPE "public"."stock_reservation_status" AS ENUM('active', 'released', 'committed', 'expired');--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_on_hand_nonnegative" CHECK ("inventory_balances"."on_hand" >= 0),
	CONSTRAINT "inventory_balances_reserved_nonnegative" CHECK ("inventory_balances"."reserved" >= 0),
	CONSTRAINT "inventory_balances_reserved_lte_on_hand" CHECK ("inventory_balances"."reserved" <= "inventory_balances"."on_hand"),
	CONSTRAINT "inventory_balances_reorder_point_nonnegative" CHECK ("inventory_balances"."reorder_point" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "inventory_location_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"reservation_id" uuid,
	"type" "inventory_movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"on_hand_delta" integer NOT NULL,
	"reserved_delta" integer NOT NULL,
	"on_hand_after" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"idempotency_key" text NOT NULL,
	"command_fingerprint" text NOT NULL,
	"reason" text,
	"actor_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_quantity_positive" CHECK ("inventory_movements"."quantity" > 0),
	CONSTRAINT "inventory_movements_on_hand_after_nonnegative" CHECK ("inventory_movements"."on_hand_after" >= 0),
	CONSTRAINT "inventory_movements_reserved_after_nonnegative" CHECK ("inventory_movements"."reserved_after" >= 0),
	CONSTRAINT "inventory_movements_reserved_after_lte_on_hand" CHECK ("inventory_movements"."reserved_after" <= "inventory_movements"."on_hand_after"),
	CONSTRAINT "inventory_movements_adjust_reason_required" CHECK ("inventory_movements"."type" <> 'adjust' OR length(trim(coalesce("inventory_movements"."reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "stock_reservation_status" DEFAULT 'active' NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservations_quantity_positive" CHECK ("stock_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_tenant_id_id_uq" ON "inventory_locations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_tenant_id_id_uq" ON "stock_reservations" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_tenant_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."inventory_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."inventory_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."stock_reservations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."inventory_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."product_variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_balances_tenant_location_variant_uq" ON "inventory_balances" USING btree ("tenant_id","location_id","variant_id");--> statement-breakpoint
CREATE INDEX "inventory_balances_tenant_variant_idx" ON "inventory_balances" USING btree ("tenant_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_tenant_code_uq" ON "inventory_locations" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_one_default_uq" ON "inventory_locations" USING btree ("tenant_id") WHERE "inventory_locations"."is_default" = true;--> statement-breakpoint
CREATE INDEX "inventory_locations_tenant_status_idx" ON "inventory_locations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_tenant_idempotency_uq" ON "inventory_movements" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_variant_created_idx" ON "inventory_movements" USING btree ("tenant_id","variant_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_reservation_idx" ON "inventory_movements" USING btree ("tenant_id","reservation_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_tenant_status_idx" ON "stock_reservations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "stock_reservations_tenant_reference_idx" ON "stock_reservations" USING btree ("tenant_id","reference_type","reference_id");