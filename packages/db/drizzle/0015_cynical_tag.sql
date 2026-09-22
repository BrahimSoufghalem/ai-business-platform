CREATE TYPE "public"."ai_intent" AS ENUM('faq', 'product_discovery', 'pricing', 'order_draft', 'order_confirmation', 'order_status', 'handoff', 'summary');--> statement-breakpoint
CREATE TYPE "public"."ai_run_outcome" AS ENUM('completed', 'handoff');--> statement-breakpoint
CREATE TYPE "public"."ai_task" AS ENUM('classify', 'compose', 'negotiate', 'summarize');--> statement-breakpoint
CREATE TYPE "public"."ai_tool_call_status" AS ENUM('succeeded', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_tool_kind" AS ENUM('read', 'command');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid,
	"task" "ai_task" NOT NULL,
	"intent" "ai_intent" NOT NULL,
	"prompt_version" text NOT NULL,
	"routing_version" text,
	"provider" text,
	"model" text,
	"model_version" text,
	"outcome" "ai_run_outcome" NOT NULL,
	"handoff_reason" text,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost_usd" numeric(14, 6) NOT NULL,
	"attempt_count" integer NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"safe_input" jsonb NOT NULL,
	"safe_output" jsonb NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_latency_nonnegative" CHECK ("ai_runs"."latency_ms" >= 0),
	CONSTRAINT "ai_runs_input_tokens_nonnegative" CHECK ("ai_runs"."input_tokens" >= 0),
	CONSTRAINT "ai_runs_output_tokens_nonnegative" CHECK ("ai_runs"."output_tokens" >= 0),
	CONSTRAINT "ai_runs_cost_nonnegative" CHECK ("ai_runs"."estimated_cost_usd" >= 0),
	CONSTRAINT "ai_runs_attempt_count_nonnegative" CHECK ("ai_runs"."attempt_count" >= 0),
	CONSTRAINT "ai_runs_prompt_version_not_blank" CHECK (length(trim("ai_runs"."prompt_version")) > 0),
	CONSTRAINT "ai_runs_correlation_id_not_blank" CHECK (length(trim("ai_runs"."correlation_id")) > 0),
	CONSTRAINT "ai_runs_outcome_shape" CHECK ((
        ("ai_runs"."outcome" = 'completed'
          and "ai_runs"."provider" is not null
          and "ai_runs"."model" is not null
          and "ai_runs"."model_version" is not null
          and "ai_runs"."routing_version" is not null
          and "ai_runs"."handoff_reason" is null)
        or
        ("ai_runs"."outcome" = 'handoff' and "ai_runs"."handoff_reason" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "ai_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"provider_call_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "ai_tool_kind" NOT NULL,
	"status" "ai_tool_call_status" NOT NULL,
	"latency_ms" integer NOT NULL,
	"safe_input" jsonb NOT NULL,
	"safe_output" jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_tool_calls_name_not_blank" CHECK (length(trim("ai_tool_calls"."name")) > 0),
	CONSTRAINT "ai_tool_calls_provider_id_not_blank" CHECK (length(trim("ai_tool_calls"."provider_call_id")) > 0),
	CONSTRAINT "ai_tool_calls_latency_nonnegative" CHECK ("ai_tool_calls"."latency_ms" >= 0),
	CONSTRAINT "ai_tool_calls_status_shape" CHECK ((
        ("ai_tool_calls"."status" = 'succeeded' and "ai_tool_calls"."error_code" is null)
        or
        ("ai_tool_calls"."status" in ('rejected', 'failed') and "ai_tool_calls"."error_code" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_tenant_id_id_uq" ON "ai_runs" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."ai_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_tenant_created_idx" ON "ai_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_tenant_conversation_created_idx" ON "ai_runs" USING btree ("tenant_id","conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tool_calls_tenant_id_id_uq" ON "ai_tool_calls" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "ai_tool_calls_tenant_run_created_idx" ON "ai_tool_calls" USING btree ("tenant_id","run_id","created_at");