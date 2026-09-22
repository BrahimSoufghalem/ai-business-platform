CREATE TYPE "public"."conversation_channel" AS ENUM('internal', 'instagram', 'whatsapp', 'web', 'email');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('bot', 'needs_human', 'human', 'closed');--> statement-breakpoint
CREATE TYPE "public"."customer_contact_type" AS ENUM('phone', 'email', 'whatsapp', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound', 'internal');--> statement-breakpoint
CREATE TYPE "public"."message_sender_type" AS ENUM('customer', 'agent', 'bot', 'system');--> statement-breakpoint
CREATE TABLE "conversation_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"from_status" "conversation_status",
	"to_status" "conversation_status" NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" "conversation_channel" NOT NULL,
	"external_thread_id" text,
	"status" "conversation_status" DEFAULT 'bot' NOT NULL,
	"assigned_to_user_id" uuid,
	"subject" text,
	"product_id" uuid,
	"draft_order_id" uuid,
	"order_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"last_message_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_version_positive" CHECK ("conversations"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text,
	"recipient_name" text,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"region" text,
	"postal_code" text,
	"country_code" text DEFAULT 'DZ' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_line1_not_blank" CHECK (length(trim("customer_addresses"."line1")) > 0),
	CONSTRAINT "customer_addresses_city_not_blank" CHECK (length(trim("customer_addresses"."city")) > 0),
	CONSTRAINT "customer_addresses_country_code_length" CHECK (length(trim("customer_addresses"."country_code")) = 2)
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" "customer_contact_type" NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_contacts_value_not_blank" CHECK (length(trim("customer_contacts"."value")) > 0),
	CONSTRAINT "customer_contacts_normalized_not_blank" CHECK (length(trim("customer_contacts"."normalized_value")) > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notes_body_not_blank" CHECK (length(trim("customer_notes"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "customer_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_name_not_blank" CHECK (length(trim("customers"."name")) > 0),
	CONSTRAINT "customers_version_positive" CHECK ("customers"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"sender_type" "message_sender_type" NOT NULL,
	"sender_id" text,
	"external_id" text,
	"fingerprint" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_fingerprint_not_blank" CHECK (length(trim("messages"."fingerprint")) > 0),
	CONSTRAINT "messages_content_not_blank" CHECK (length(trim("messages"."content")) > 0)
);
--> statement-breakpoint
ALTER TABLE "draft_orders" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_id_id_uq" ON "customers" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_tenant_id_id_uq" ON "conversations" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "conversation_transitions" ADD CONSTRAINT "conversation_transitions_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_assignee_fk" FOREIGN KEY ("tenant_id","assigned_to_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_draft_order_fk" FOREIGN KEY ("tenant_id","draft_order_id") REFERENCES "public"."draft_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_transitions_tenant_id_id_uq" ON "conversation_transitions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "conversation_transitions_tenant_conversation_created_idx" ON "conversation_transitions" USING btree ("tenant_id","conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_tenant_channel_external_thread_uq" ON "conversations" USING btree ("tenant_id","channel","external_thread_id");--> statement-breakpoint
CREATE INDEX "conversations_tenant_status_last_message_idx" ON "conversations" USING btree ("tenant_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_tenant_customer_created_idx" ON "conversations" USING btree ("tenant_id","customer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_tenant_id_id_uq" ON "customer_addresses" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "customer_addresses_tenant_customer_idx" ON "customer_addresses" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contacts_tenant_id_id_uq" ON "customer_contacts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_contacts_tenant_normalized_uq" ON "customer_contacts" USING btree ("tenant_id","normalized_value");--> statement-breakpoint
CREATE INDEX "customer_contacts_tenant_customer_idx" ON "customer_contacts" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_notes_tenant_id_id_uq" ON "customer_notes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "customer_notes_tenant_customer_created_idx" ON "customer_notes" USING btree ("tenant_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customers_tenant_name_idx" ON "customers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tenant_id_id_uq" ON "messages" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tenant_conversation_external_uq" ON "messages" USING btree ("tenant_id","conversation_id","external_id");--> statement-breakpoint
CREATE INDEX "messages_tenant_conversation_created_idx" ON "messages" USING btree ("tenant_id","conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_orders_tenant_customer_created_idx" ON "draft_orders" USING btree ("tenant_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_tenant_customer_created_idx" ON "orders" USING btree ("tenant_id","customer_id","created_at");