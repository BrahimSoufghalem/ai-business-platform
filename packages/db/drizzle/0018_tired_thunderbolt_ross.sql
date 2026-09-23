CREATE TYPE "public"."handoff_reason" AS ENUM('explicit_customer_request', 'low_confidence', 'safety_risk', 'tool_failure', 'pricing_policy', 'order_exception', 'unsupported_request', 'manual');--> statement-breakpoint
CREATE TYPE "public"."handoff_resolution" AS ENUM('completed', 'returned_to_bot', 'conversation_closed');--> statement-breakpoint
CREATE TYPE "public"."handoff_status" AS ENUM('pending', 'active', 'resolved');--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"customer_notice_message_id" uuid,
	"source_run_id" uuid NOT NULL,
	"reason" "handoff_reason" NOT NULL,
	"status" "handoff_status" DEFAULT 'pending' NOT NULL,
	"resolution" "handoff_resolution",
	"intent" "ai_intent" NOT NULL,
	"summary" jsonb NOT NULL,
	"assigned_to_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_claimed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoffs_version_positive" CHECK ("handoffs"."version" > 0),
	CONSTRAINT "handoffs_idempotency_not_blank" CHECK (length(trim("handoffs"."idempotency_key")) > 0),
	CONSTRAINT "handoffs_summary_object" CHECK (jsonb_typeof("handoffs"."summary") = 'object'),
	CONSTRAINT "handoffs_status_shape" CHECK ((
        (
          "handoffs"."status" = 'pending'
          and "handoffs"."assigned_to_user_id" is null
          and "handoffs"."claimed_at" is null
          and "handoffs"."resolved_at" is null
          and "handoffs"."resolution" is null
        )
        or
        (
          "handoffs"."status" = 'active'
          and "handoffs"."assigned_to_user_id" is not null
          and "handoffs"."claimed_at" is not null
          and "handoffs"."resolved_at" is null
          and "handoffs"."resolution" is null
        )
        or
        (
          "handoffs"."status" = 'resolved'
          and "handoffs"."claimed_at" is null
          and "handoffs"."resolved_at" is not null
          and "handoffs"."resolution" is not null
        )
      ))
);
--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_source_message_fk" FOREIGN KEY ("tenant_id","source_message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_notice_message_fk" FOREIGN KEY ("tenant_id","customer_notice_message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_source_run_fk" FOREIGN KEY ("tenant_id","source_run_id") REFERENCES "public"."ai_runs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_assignee_fk" FOREIGN KEY ("tenant_id","assigned_to_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handoffs_tenant_id_id_uq" ON "handoffs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "handoffs_tenant_idempotency_uq" ON "handoffs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "handoffs_tenant_notice_message_uq" ON "handoffs" USING btree ("tenant_id","customer_notice_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handoffs_one_open_per_conversation_uq" ON "handoffs" USING btree ("tenant_id","conversation_id") WHERE "handoffs"."status" in ('pending', 'active');--> statement-breakpoint
CREATE INDEX "handoffs_tenant_status_requested_idx" ON "handoffs" USING btree ("tenant_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "handoffs_tenant_conversation_requested_idx" ON "handoffs" USING btree ("tenant_id","conversation_id","requested_at");--> statement-breakpoint

ALTER TABLE "handoffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "handoffs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "handoffs_isolation" ON "handoffs"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_protect_handoff_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
    OR NEW.source_run_id IS DISTINCT FROM OLD.source_run_id
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.intent IS DISTINCT FROM OLD.intent
    OR NEW.summary IS DISTINCT FROM OLD.summary
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR (
      OLD.customer_notice_message_id IS NOT NULL
      AND NEW.customer_notice_message_id IS DISTINCT FROM OLD.customer_notice_message_id
    )
  THEN
    RAISE EXCEPTION 'handoff source and summary are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER handoffs_protect_identity
BEFORE UPDATE ON "handoffs"
FOR EACH ROW EXECUTE FUNCTION app_protect_handoff_identity();--> statement-breakpoint

COMMENT ON TABLE "handoffs" IS
  'Tenant-scoped human handoff lifecycle with a redacted immutable context summary.';
COMMENT ON COLUMN "handoffs"."summary" IS
  'Structured summary containing masked contact hints and collection booleans, never full contact or address data.';
COMMENT ON COLUMN "handoffs"."first_claimed_at" IS
  'First human response timestamp used for queue wait metrics.';
COMMENT ON COLUMN "handoffs"."resolved_at" IS
  'Resolution timestamp used for end-to-end handoff duration metrics.';