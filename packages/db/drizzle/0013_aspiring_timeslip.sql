CREATE TYPE "public"."agent_tone" AS ENUM('professional', 'friendly', 'concise', 'warm');--> statement-breakpoint
CREATE TYPE "public"."configuration_version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."knowledge_entry_kind" AS ENUM('faq', 'article', 'policy');--> statement-breakpoint
CREATE TYPE "public"."price_decision_outcome" AS ENUM('accept', 'counter', 'handoff', 'reject');--> statement-breakpoint
CREATE TABLE "agent_settings_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "configuration_version_status" DEFAULT 'draft' NOT NULL,
	"language" text NOT NULL,
	"tone" "agent_tone" NOT NULL,
	"handoff_notes" text DEFAULT '' NOT NULL,
	"change_note" text,
	"created_by" text NOT NULL,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "agent_settings_versions_version_positive" CHECK ("agent_settings_versions"."version" > 0),
	CONSTRAINT "agent_settings_versions_language_allowed" CHECK ("agent_settings_versions"."language" in ('ar', 'fr', 'en')),
	CONSTRAINT "agent_settings_versions_handoff_notes_length" CHECK (length("agent_settings_versions"."handoff_notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "business_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_rule_sets_key_not_blank" CHECK (length(trim("business_rule_sets"."key")) > 0),
	CONSTRAINT "business_rule_sets_name_not_blank" CHECK (length(trim("business_rule_sets"."name")) > 0),
	CONSTRAINT "business_rule_sets_version_positive" CHECK ("business_rule_sets"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "business_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "configuration_version_status" DEFAULT 'draft' NOT NULL,
	"policy" jsonb NOT NULL,
	"change_note" text,
	"created_by" text NOT NULL,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "business_rule_versions_version_positive" CHECK ("business_rule_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"kind" "knowledge_entry_kind" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_entries_slug_not_blank" CHECK (length(trim("knowledge_entries"."slug")) > 0),
	CONSTRAINT "knowledge_entries_version_positive" CHECK ("knowledge_entries"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "configuration_version_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"question" text,
	"content" text NOT NULL,
	"change_note" text,
	"created_by" text NOT NULL,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "knowledge_versions_version_positive" CHECK ("knowledge_versions"."version" > 0),
	CONSTRAINT "knowledge_versions_title_not_blank" CHECK (length(trim("knowledge_versions"."title")) > 0),
	CONSTRAINT "knowledge_versions_content_not_blank" CHECK (length(trim("knowledge_versions"."content")) > 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"rule_version" integer NOT NULL,
	"product_id" uuid,
	"conversation_id" uuid,
	"currency" text NOT NULL,
	"list_price" numeric(14, 2) NOT NULL,
	"requested_price" numeric(14, 2) NOT NULL,
	"decided_price" numeric(14, 2),
	"outcome" "price_decision_outcome" NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_decisions_rule_version_positive" CHECK ("pricing_decisions"."rule_version" > 0),
	CONSTRAINT "pricing_decisions_list_price_nonnegative" CHECK ("pricing_decisions"."list_price" >= 0),
	CONSTRAINT "pricing_decisions_requested_price_nonnegative" CHECK ("pricing_decisions"."requested_price" >= 0),
	CONSTRAINT "pricing_decisions_decided_price_nonnegative" CHECK ("pricing_decisions"."decided_price" is null or "pricing_decisions"."decided_price" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "business_rule_sets_tenant_id_id_uq" ON "business_rule_sets" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_rule_versions_tenant_set_id_uq" ON "business_rule_versions" USING btree ("tenant_id","rule_set_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entries_tenant_id_id_uq" ON "knowledge_entries" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "agent_settings_versions" ADD CONSTRAINT "agent_settings_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_rule_sets" ADD CONSTRAINT "business_rule_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_rule_versions" ADD CONSTRAINT "business_rule_versions_tenant_set_fk" FOREIGN KEY ("tenant_id","rule_set_id") REFERENCES "public"."business_rule_sets"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_tenant_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."knowledge_entries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_tenant_set_fk" FOREIGN KEY ("tenant_id","rule_set_id") REFERENCES "public"."business_rule_sets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_tenant_rule_version_fk" FOREIGN KEY ("tenant_id","rule_set_id","rule_version_id") REFERENCES "public"."business_rule_versions"("tenant_id","rule_set_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_settings_versions_tenant_id_id_uq" ON "agent_settings_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_settings_versions_tenant_version_uq" ON "agent_settings_versions" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_settings_versions_one_draft_uq" ON "agent_settings_versions" USING btree ("tenant_id") WHERE "agent_settings_versions"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_settings_versions_one_published_uq" ON "agent_settings_versions" USING btree ("tenant_id") WHERE "agent_settings_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "agent_settings_versions_tenant_status_idx" ON "agent_settings_versions" USING btree ("tenant_id","status","version");--> statement-breakpoint
CREATE UNIQUE INDEX "business_rule_sets_tenant_key_uq" ON "business_rule_sets" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "business_rule_sets_tenant_updated_idx" ON "business_rule_sets" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_rule_versions_tenant_id_id_uq" ON "business_rule_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_rule_versions_tenant_set_version_uq" ON "business_rule_versions" USING btree ("tenant_id","rule_set_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "business_rule_versions_one_draft_uq" ON "business_rule_versions" USING btree ("tenant_id","rule_set_id") WHERE "business_rule_versions"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "business_rule_versions_one_published_uq" ON "business_rule_versions" USING btree ("tenant_id","rule_set_id") WHERE "business_rule_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "business_rule_versions_tenant_set_status_idx" ON "business_rule_versions" USING btree ("tenant_id","rule_set_id","status","version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entries_tenant_slug_uq" ON "knowledge_entries" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "knowledge_entries_tenant_kind_updated_idx" ON "knowledge_entries" USING btree ("tenant_id","kind","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_versions_tenant_id_id_uq" ON "knowledge_versions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_versions_tenant_entry_version_uq" ON "knowledge_versions" USING btree ("tenant_id","entry_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_versions_one_draft_uq" ON "knowledge_versions" USING btree ("tenant_id","entry_id") WHERE "knowledge_versions"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_versions_one_published_uq" ON "knowledge_versions" USING btree ("tenant_id","entry_id") WHERE "knowledge_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "knowledge_versions_tenant_entry_status_idx" ON "knowledge_versions" USING btree ("tenant_id","entry_id","status","version");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_decisions_tenant_id_id_uq" ON "pricing_decisions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "pricing_decisions_tenant_set_created_idx" ON "pricing_decisions" USING btree ("tenant_id","rule_set_id","created_at");