CREATE TYPE "public"."attribute_data_type" AS ENUM('text', 'number', 'boolean', 'select', 'multi_select');--> statement-breakpoint
CREATE TYPE "public"."product_type_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_type_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"data_type" "attribute_data_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"searchable" boolean DEFAULT false NOT NULL,
	"variant_axis" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"template_key" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"status" "product_type_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_types_tenant_id_id_uq" ON "product_types" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_tenant_product_type_fk" FOREIGN KEY ("tenant_id","product_type_id") REFERENCES "public"."product_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_definitions_product_type_key_uq" ON "attribute_definitions" USING btree ("product_type_id","key");--> statement-breakpoint
CREATE INDEX "attribute_definitions_tenant_product_type_idx" ON "attribute_definitions" USING btree ("tenant_id","product_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_types_tenant_slug_uq" ON "product_types" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "product_types_tenant_status_idx" ON "product_types" USING btree ("tenant_id","status");