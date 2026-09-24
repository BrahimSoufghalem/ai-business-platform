CREATE TYPE "public"."instagram_delivery_job_status" AS ENUM('pending', 'processing', 'delivered', 'dead');--> statement-breakpoint
CREATE TABLE "instagram_delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"status" "instagram_delivery_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"external_message_id" text,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_delivery_jobs_attempts_nonnegative" CHECK ("instagram_delivery_jobs"."attempts" >= 0),
	CONSTRAINT "instagram_delivery_jobs_max_attempts_positive" CHECK ("instagram_delivery_jobs"."max_attempts" between 1 and 20),
	CONSTRAINT "instagram_delivery_jobs_attempts_bounded" CHECK ("instagram_delivery_jobs"."attempts" <= "instagram_delivery_jobs"."max_attempts"),
	CONSTRAINT "instagram_delivery_jobs_correlation_not_blank" CHECK (length(trim("instagram_delivery_jobs"."correlation_id")) > 0),
	CONSTRAINT "instagram_delivery_jobs_lock_shape" CHECK ((
        ("instagram_delivery_jobs"."status" = 'processing' and "instagram_delivery_jobs"."locked_at" is not null and "instagram_delivery_jobs"."locked_by" is not null)
        or
        ("instagram_delivery_jobs"."status" <> 'processing' and "instagram_delivery_jobs"."locked_at" is null and "instagram_delivery_jobs"."locked_by" is null)
      )),
	CONSTRAINT "instagram_delivery_jobs_terminal_shape" CHECK ((
        ("instagram_delivery_jobs"."status" = 'delivered' and "instagram_delivery_jobs"."completed_at" is not null and "instagram_delivery_jobs"."external_message_id" is not null)
        or
        ("instagram_delivery_jobs"."status" = 'dead' and "instagram_delivery_jobs"."completed_at" is not null)
        or
        ("instagram_delivery_jobs"."status" in ('pending', 'processing') and "instagram_delivery_jobs"."completed_at" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "instagram_delivery_jobs" ADD CONSTRAINT "instagram_delivery_jobs_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_delivery_jobs" ADD CONSTRAINT "instagram_delivery_jobs_tenant_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_delivery_jobs_message_uq" ON "instagram_delivery_jobs" USING btree ("tenant_id","message_id");--> statement-breakpoint
CREATE INDEX "instagram_delivery_jobs_ready_idx" ON "instagram_delivery_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint

ALTER TABLE "instagram_delivery_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instagram_delivery_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "instagram_delivery_jobs_isolation" ON "instagram_delivery_jobs"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_has_active_tenant_membership("tenant_id")
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_enqueue_instagram_delivery()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  target_channel conversation_channel;
BEGIN
  IF NEW.direction <> 'outbound' THEN
    RETURN NEW;
  END IF;

  SELECT conversation.channel
  INTO target_channel
  FROM conversations AS conversation
  WHERE conversation.tenant_id = NEW.tenant_id
    AND conversation.id = NEW.conversation_id;

  IF target_channel = 'instagram' THEN
    INSERT INTO instagram_delivery_jobs (
      tenant_id, conversation_id, message_id, correlation_id
    ) VALUES (
      NEW.tenant_id,
      NEW.conversation_id,
      NEW.id,
      COALESCE(
        NULLIF(current_setting('app.correlation_id', true), ''),
        'instagram-delivery:' || NEW.id::text
      )
    )
    ON CONFLICT (tenant_id, message_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER messages_enqueue_instagram_delivery
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION app_enqueue_instagram_delivery();--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_claim_instagram_delivery_job(target_worker_id text)
RETURNS TABLE (
  job_id uuid,
  tenant_id uuid,
  conversation_id uuid,
  message_id uuid,
  recipient_id text,
  content text,
  attempts integer,
  max_attempts integer,
  correlation_id text,
  account_id text,
  account_status text,
  access_token_ciphertext text,
  access_token_iv text,
  access_token_auth_tag text,
  encryption_key_version integer,
  token_fingerprint text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  selected_job_id uuid;
BEGIN
  IF target_worker_id IS NULL
    OR length(trim(target_worker_id)) NOT BETWEEN 1 AND 100
    OR target_worker_id !~ '^[A-Za-z0-9._:-]+$'
  THEN
    RAISE EXCEPTION 'invalid delivery worker ID' USING ERRCODE = '22023';
  END IF;

  SELECT job.id
  INTO selected_job_id
  FROM instagram_delivery_jobs AS job
  WHERE (
      job.status = 'pending'
      AND job.available_at <= now()
    )
    OR (
      job.status = 'processing'
      AND job.locked_at < now() - interval '5 minutes'
    )
  ORDER BY job.available_at, job.created_at
  FOR UPDATE OF job SKIP LOCKED
  LIMIT 1;

  IF selected_job_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE instagram_delivery_jobs AS job
  SET
    status = 'processing',
    attempts = job.attempts + 1,
    locked_at = now(),
    locked_by = target_worker_id,
    updated_at = now()
  WHERE job.id = selected_job_id
    AND job.attempts < job.max_attempts;

  IF NOT FOUND THEN
    UPDATE instagram_delivery_jobs AS job
    SET
      status = 'dead',
      completed_at = now(),
      locked_at = null,
      locked_by = null,
      last_error_code = 'attempts_exhausted',
      updated_at = now()
    WHERE job.id = selected_job_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    job.id,
    job.tenant_id,
    job.conversation_id,
    job.message_id,
    conversation.external_thread_id,
    message.content,
    job.attempts,
    job.max_attempts,
    job.correlation_id,
    account.instagram_account_id,
    account.status::text,
    account.access_token_ciphertext,
    account.access_token_iv,
    account.access_token_auth_tag,
    account.encryption_key_version,
    account.token_fingerprint
  FROM instagram_delivery_jobs AS job
  INNER JOIN conversations AS conversation
    ON conversation.tenant_id = job.tenant_id
    AND conversation.id = job.conversation_id
  INNER JOIN messages AS message
    ON message.tenant_id = job.tenant_id
    AND message.id = job.message_id
  LEFT JOIN instagram_accounts AS account
    ON account.tenant_id = job.tenant_id
  WHERE job.id = selected_job_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_complete_instagram_delivery_job(
  target_job_id uuid,
  target_worker_id text,
  target_external_message_id text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  completed_job instagram_delivery_jobs%ROWTYPE;
BEGIN
  IF target_external_message_id IS NULL
    OR length(trim(target_external_message_id)) NOT BETWEEN 1 AND 200
  THEN
    RAISE EXCEPTION 'invalid Instagram external message ID' USING ERRCODE = '22023';
  END IF;

  UPDATE instagram_delivery_jobs AS job
  SET
    status = 'delivered',
    completed_at = now(),
    locked_at = null,
    locked_by = null,
    last_error_code = null,
    external_message_id = target_external_message_id,
    updated_at = now()
  WHERE job.id = target_job_id
    AND job.status = 'processing'
    AND job.locked_by = target_worker_id
  RETURNING job.* INTO completed_job;

  IF completed_job.id IS NULL THEN
    RAISE EXCEPTION 'Instagram delivery lease is no longer owned'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO audit_events (
    tenant_id, actor_type, actor_id, action, entity_type,
    entity_id, correlation_id, metadata
  ) VALUES (
    completed_job.tenant_id,
    'system',
    'instagram-delivery-worker',
    'instagram.message.delivered',
    'message',
    completed_job.message_id::text,
    completed_job.correlation_id,
    jsonb_build_object(
      'jobId', completed_job.id,
      'attempts', completed_job.attempts,
      'externalMessageId', target_external_message_id
    )
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_fail_instagram_delivery_job(
  target_job_id uuid,
  target_worker_id text,
  target_error_code text,
  target_retry_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  failed_job instagram_delivery_jobs%ROWTYPE;
  next_status instagram_delivery_job_status;
BEGIN
  IF target_error_code IS NULL
    OR length(trim(target_error_code)) NOT BETWEEN 1 AND 100
    OR target_error_code !~ '^[a-z0-9_:-]+$'
  THEN
    RAISE EXCEPTION 'invalid delivery error code' USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO failed_job
  FROM instagram_delivery_jobs AS job
  WHERE job.id = target_job_id
    AND job.status = 'processing'
    AND job.locked_by = target_worker_id
  FOR UPDATE;

  IF failed_job.id IS NULL THEN
    RAISE EXCEPTION 'Instagram delivery lease is no longer owned'
      USING ERRCODE = '55000';
  END IF;

  next_status := CASE
    WHEN target_retry_at IS NOT NULL
      AND failed_job.attempts < failed_job.max_attempts
    THEN 'pending'::instagram_delivery_job_status
    ELSE 'dead'::instagram_delivery_job_status
  END;

  UPDATE instagram_delivery_jobs AS job
  SET
    status = next_status,
    available_at = CASE
      WHEN next_status = 'pending'
      THEN greatest(target_retry_at, now() + interval '1 second')
      ELSE job.available_at
    END,
    completed_at = CASE WHEN next_status = 'dead' THEN now() ELSE null END,
    locked_at = null,
    locked_by = null,
    last_error_code = target_error_code,
    updated_at = now()
  WHERE job.id = failed_job.id;

  INSERT INTO audit_events (
    tenant_id, actor_type, actor_id, action, entity_type,
    entity_id, correlation_id, metadata
  ) VALUES (
    failed_job.tenant_id,
    'system',
    'instagram-delivery-worker',
    CASE
      WHEN next_status = 'pending'
      THEN 'instagram.delivery.retry_scheduled'
      ELSE 'instagram.delivery.dead_lettered'
    END,
    'message',
    failed_job.message_id::text,
    failed_job.correlation_id,
    jsonb_build_object(
      'jobId', failed_job.id,
      'attempts', failed_job.attempts,
      'maxAttempts', failed_job.max_attempts,
      'errorCode', target_error_code,
      'retryAt', CASE WHEN next_status = 'pending' THEN target_retry_at ELSE null END
    )
  );

  RETURN next_status::text;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app_claim_instagram_delivery_job(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_complete_instagram_delivery_job(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_fail_instagram_delivery_job(uuid, text, text, timestamptz) FROM PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_business_runtime') THEN
    GRANT EXECUTE ON FUNCTION app_claim_instagram_delivery_job(text)
      TO ai_business_runtime;
    GRANT EXECUTE ON FUNCTION app_complete_instagram_delivery_job(uuid, text, text)
      TO ai_business_runtime;
    GRANT EXECUTE ON FUNCTION app_fail_instagram_delivery_job(uuid, text, text, timestamptz)
      TO ai_business_runtime;
  END IF;
END
$$;--> statement-breakpoint

COMMENT ON TABLE instagram_delivery_jobs IS
  'Durable outbox with leases, bounded retries, and dead-letter state for Instagram replies.';
COMMENT ON FUNCTION app_claim_instagram_delivery_job(text) IS
  'Claims one due Instagram delivery with SKIP LOCKED and reclaims stale five-minute leases.';