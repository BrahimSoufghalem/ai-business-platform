CREATE TYPE "public"."message_processing_job_status" AS ENUM('pending', 'processing', 'completed', 'dead');--> statement-breakpoint
CREATE TABLE "message_processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_message_id" uuid NOT NULL,
	"kind" text DEFAULT 'agent_reply' NOT NULL,
	"status" "message_processing_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_processing_jobs_kind_supported" CHECK ("message_processing_jobs"."kind" = 'agent_reply'),
	CONSTRAINT "message_processing_jobs_attempts_nonnegative" CHECK ("message_processing_jobs"."attempts" >= 0),
	CONSTRAINT "message_processing_jobs_max_attempts_positive" CHECK ("message_processing_jobs"."max_attempts" between 1 and 20),
	CONSTRAINT "message_processing_jobs_attempts_bounded" CHECK ("message_processing_jobs"."attempts" <= "message_processing_jobs"."max_attempts"),
	CONSTRAINT "message_processing_jobs_correlation_not_blank" CHECK (length(trim("message_processing_jobs"."correlation_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "message_processing_jobs" ADD CONSTRAINT "message_processing_jobs_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_processing_jobs" ADD CONSTRAINT "message_processing_jobs_tenant_message_fk" FOREIGN KEY ("tenant_id","source_message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_processing_jobs_message_kind_uq" ON "message_processing_jobs" USING btree ("tenant_id","source_message_id","kind");--> statement-breakpoint
CREATE INDEX "message_processing_jobs_ready_idx" ON "message_processing_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint

ALTER TABLE "message_processing_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_processing_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "message_processing_jobs_isolation" ON "message_processing_jobs"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_ingest_instagram_message(
  target_account_id text,
  target_external_message_id text,
  target_external_thread_id text,
  target_sender_id text,
  target_received_at timestamptz,
  target_content text,
  target_metadata jsonb,
  target_fingerprint text,
  target_correlation_id text
)
RETURNS TABLE (
  tenant_id uuid,
  conversation_id uuid,
  message_id uuid,
  replayed boolean,
  job_enqueued boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  resolved_tenant_id uuid;
  resolved_customer_id uuid;
  resolved_conversation_id uuid;
  resolved_message_id uuid;
  existing_fingerprint text;
  queued_job_id uuid;
  normalized_contact text;
BEGIN
  IF target_account_id !~ '^[0-9]{1,80}$'
    OR target_external_message_id IS NULL
    OR length(target_external_message_id) NOT BETWEEN 1 AND 200
    OR target_external_thread_id !~ '^[0-9]{1,200}$'
    OR target_sender_id <> target_external_thread_id
    OR target_received_at IS NULL
    OR target_content IS NULL
    OR length(trim(target_content)) NOT BETWEEN 1 AND 20000
    OR target_metadata IS NULL
    OR jsonb_typeof(target_metadata) <> 'object'
    OR target_fingerprint !~ '^[a-f0-9]{64}$'
    OR target_correlation_id IS NULL
    OR length(trim(target_correlation_id)) NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'invalid Instagram message envelope' USING ERRCODE = '22000';
  END IF;

  SELECT account.tenant_id
  INTO resolved_tenant_id
  FROM instagram_accounts AS account
  WHERE account.instagram_account_id = target_account_id
    AND account.status = 'active'
  LIMIT 1;

  IF resolved_tenant_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      resolved_tenant_id::text || ':instagram-message:' || target_external_message_id,
      0::bigint
    )
  );

  SELECT message.id, message.conversation_id, message.fingerprint
  INTO resolved_message_id, resolved_conversation_id, existing_fingerprint
  FROM messages AS message
  INNER JOIN conversations AS conversation
    ON conversation.tenant_id = message.tenant_id
    AND conversation.id = message.conversation_id
  WHERE message.tenant_id = resolved_tenant_id
    AND conversation.channel = 'instagram'
    AND message.external_id = target_external_message_id
  LIMIT 1;

  IF resolved_message_id IS NOT NULL THEN
    IF existing_fingerprint IS DISTINCT FROM target_fingerprint THEN
      RAISE EXCEPTION 'Instagram external message ID reused with different content'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT
      resolved_tenant_id, resolved_conversation_id, resolved_message_id, true, false;
    RETURN;
  END IF;

  normalized_contact := 'igsid:' || target_sender_id;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(resolved_tenant_id::text || ':instagram-contact:' || normalized_contact, 0::bigint)
  );

  SELECT contact.customer_id
  INTO resolved_customer_id
  FROM customer_contacts AS contact
  WHERE contact.tenant_id = resolved_tenant_id
    AND contact.normalized_value = normalized_contact
  LIMIT 1;

  IF resolved_customer_id IS NULL THEN
    INSERT INTO customers (tenant_id, name, metadata)
    VALUES (
      resolved_tenant_id,
      'Instagram customer ••••' || right(target_sender_id, 4),
      jsonb_build_object('source', 'instagram_webhook')
    )
    RETURNING id INTO resolved_customer_id;

    INSERT INTO customer_contacts (
      tenant_id, customer_id, type, value, normalized_value, label, is_primary
    ) VALUES (
      resolved_tenant_id, resolved_customer_id, 'instagram',
      target_sender_id, normalized_contact, 'Instagram IGSID', true
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      resolved_tenant_id::text || ':instagram-thread:' || target_external_thread_id,
      0::bigint
    )
  );

  SELECT conversation.id
  INTO resolved_conversation_id
  FROM conversations AS conversation
  WHERE conversation.tenant_id = resolved_tenant_id
    AND conversation.channel = 'instagram'
    AND conversation.external_thread_id = target_external_thread_id
  LIMIT 1;

  IF resolved_conversation_id IS NULL THEN
    INSERT INTO conversations (
      tenant_id, customer_id, channel, external_thread_id, status
    ) VALUES (
      resolved_tenant_id, resolved_customer_id, 'instagram',
      target_external_thread_id, 'bot'
    )
    RETURNING id INTO resolved_conversation_id;

    INSERT INTO conversation_transitions (
      tenant_id, conversation_id, from_status, to_status, actor_id, reason
    ) VALUES (
      resolved_tenant_id, resolved_conversation_id, null, 'bot',
      'instagram-webhook', 'First inbound Instagram message'
    );
  END IF;

  INSERT INTO messages (
    tenant_id, conversation_id, direction, sender_type, sender_id,
    external_id, fingerprint, content, metadata, created_at
  ) VALUES (
    resolved_tenant_id, resolved_conversation_id, 'inbound', 'customer',
    target_sender_id, target_external_message_id, target_fingerprint,
    trim(target_content), target_metadata, least(target_received_at, now())
  )
  RETURNING id INTO resolved_message_id;

  UPDATE conversations AS target
  SET
    last_message_at = greatest(
      coalesce(target.last_message_at, least(target_received_at, now())),
      least(target_received_at, now())
    ),
    updated_at = now()
  WHERE target.tenant_id = resolved_tenant_id
    AND target.id = resolved_conversation_id;

  INSERT INTO message_processing_jobs (
    tenant_id, conversation_id, source_message_id, correlation_id
  ) VALUES (
    resolved_tenant_id, resolved_conversation_id, resolved_message_id,
    target_correlation_id
  )
  RETURNING id INTO queued_job_id;

  INSERT INTO audit_events (
    tenant_id, actor_type, actor_id, action, entity_type,
    entity_id, correlation_id, metadata
  ) VALUES (
    resolved_tenant_id, 'system', 'instagram-webhook',
    'instagram.message.ingested', 'message', resolved_message_id::text,
    target_correlation_id,
    jsonb_build_object(
      'conversationId', resolved_conversation_id,
      'externalMessageId', target_external_message_id,
      'jobEnqueued', queued_job_id IS NOT NULL
    )
  );

  RETURN QUERY SELECT
    resolved_tenant_id, resolved_conversation_id, resolved_message_id,
    false, queued_job_id IS NOT NULL;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_ingest_instagram_message(
  text, text, text, text, timestamptz, text, jsonb, text, text
) FROM PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_business_runtime') THEN
    GRANT EXECUTE ON FUNCTION app_ingest_instagram_message(
      text, text, text, text, timestamptz, text, jsonb, text, text
    ) TO ai_business_runtime;
  END IF;
END
$$;--> statement-breakpoint

COMMENT ON TABLE "message_processing_jobs" IS
  'Durable tenant-scoped queue for processing newly ingested customer messages.';
COMMENT ON FUNCTION app_ingest_instagram_message(
  text, text, text, text, timestamptz, text, jsonb, text, text
) IS
  'Atomically deduplicates a normalized Instagram envelope into customer, conversation, message, and processing job records.';