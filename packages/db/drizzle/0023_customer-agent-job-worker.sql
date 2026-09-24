ALTER TABLE "message_processing_jobs" ADD COLUMN "locked_by" text;--> statement-breakpoint
UPDATE "message_processing_jobs"
SET
  "status" = 'pending',
  "locked_at" = null,
  "available_at" = now(),
  "updated_at" = now()
WHERE "status" = 'processing';--> statement-breakpoint
ALTER TABLE "message_processing_jobs" ADD CONSTRAINT "message_processing_jobs_lock_shape" CHECK ((
        ("message_processing_jobs"."status" = 'processing' and "message_processing_jobs"."locked_at" is not null and "message_processing_jobs"."locked_by" is not null)
        or
        ("message_processing_jobs"."status" <> 'processing' and "message_processing_jobs"."locked_at" is null and "message_processing_jobs"."locked_by" is null)
      ));--> statement-breakpoint
ALTER TABLE "message_processing_jobs" ADD CONSTRAINT "message_processing_jobs_terminal_shape" CHECK ((
        ("message_processing_jobs"."status" in ('completed', 'dead') and "message_processing_jobs"."completed_at" is not null)
        or
        ("message_processing_jobs"."status" in ('pending', 'processing') and "message_processing_jobs"."completed_at" is null)
      ));--> statement-breakpoint

INSERT INTO app_users (identity_provider_id)
VALUES ('service:customer-agent-worker')
ON CONFLICT (identity_provider_id) DO NOTHING;--> statement-breakpoint

INSERT INTO memberships (tenant_id, user_id, role, status)
SELECT
  tenant.id,
  service_user.id,
  'agent'::membership_role,
  'active'::membership_status
FROM tenants AS tenant
CROSS JOIN app_users AS service_user
WHERE service_user.identity_provider_id = 'service:customer-agent-worker'
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET role = 'agent', status = 'active';--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_attach_customer_agent_service()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  service_user_id uuid;
BEGIN
  SELECT app_user.id
  INTO service_user_id
  FROM app_users AS app_user
  WHERE app_user.identity_provider_id = 'service:customer-agent-worker'
  LIMIT 1;

  IF service_user_id IS NULL THEN
    RAISE EXCEPTION 'customer agent service principal is unavailable'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO memberships (tenant_id, user_id, role, status)
  VALUES (NEW.id, service_user_id, 'agent', 'active')
  ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET role = 'agent', status = 'active';

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER tenants_attach_customer_agent_service
AFTER INSERT ON tenants
FOR EACH ROW
EXECUTE FUNCTION app_attach_customer_agent_service();--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_claim_message_processing_job(target_worker_id text)
RETURNS TABLE (
  job_id uuid,
  tenant_id uuid,
  conversation_id uuid,
  source_message_id uuid,
  attempts integer,
  max_attempts integer,
  correlation_id text
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
    RAISE EXCEPTION 'invalid message worker ID' USING ERRCODE = '22023';
  END IF;

  SELECT job.id
  INTO selected_job_id
  FROM message_processing_jobs AS job
  WHERE (
      job.status = 'pending'
      AND job.available_at <= now()
    )
    OR (
      job.status = 'processing'
      AND job.locked_at < now() - interval '10 minutes'
    )
  ORDER BY job.available_at, job.created_at
  FOR UPDATE OF job SKIP LOCKED
  LIMIT 1;

  IF selected_job_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE message_processing_jobs AS job
  SET
    status = 'processing',
    attempts = job.attempts + 1,
    locked_at = now(),
    locked_by = target_worker_id,
    updated_at = now()
  WHERE job.id = selected_job_id
    AND job.attempts < job.max_attempts;

  IF NOT FOUND THEN
    UPDATE message_processing_jobs AS job
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
    job.source_message_id,
    job.attempts,
    job.max_attempts,
    job.correlation_id
  FROM message_processing_jobs AS job
  WHERE job.id = selected_job_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_complete_message_processing_job(
  target_job_id uuid,
  target_worker_id text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  completed_job message_processing_jobs%ROWTYPE;
BEGIN
  UPDATE message_processing_jobs AS job
  SET
    status = 'completed',
    completed_at = now(),
    locked_at = null,
    locked_by = null,
    last_error_code = null,
    updated_at = now()
  WHERE job.id = target_job_id
    AND job.status = 'processing'
    AND job.locked_by = target_worker_id
  RETURNING job.* INTO completed_job;

  IF completed_job.id IS NULL THEN
    RAISE EXCEPTION 'message processing lease is no longer owned'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO audit_events (
    tenant_id, actor_type, actor_id, action, entity_type,
    entity_id, correlation_id, metadata
  ) VALUES (
    completed_job.tenant_id,
    'system',
    'customer-agent-worker',
    'customer_agent.job.completed',
    'message',
    completed_job.source_message_id::text,
    completed_job.correlation_id,
    jsonb_build_object(
      'jobId', completed_job.id,
      'attempts', completed_job.attempts
    )
  );
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_fail_message_processing_job(
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
  failed_job message_processing_jobs%ROWTYPE;
  next_status message_processing_job_status;
BEGIN
  IF target_error_code IS NULL
    OR length(trim(target_error_code)) NOT BETWEEN 1 AND 100
    OR target_error_code !~ '^[a-z0-9_:-]+$'
  THEN
    RAISE EXCEPTION 'invalid message processing error code' USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO failed_job
  FROM message_processing_jobs AS job
  WHERE job.id = target_job_id
    AND job.status = 'processing'
    AND job.locked_by = target_worker_id
  FOR UPDATE;

  IF failed_job.id IS NULL THEN
    RAISE EXCEPTION 'message processing lease is no longer owned'
      USING ERRCODE = '55000';
  END IF;

  next_status := CASE
    WHEN target_retry_at IS NOT NULL
      AND failed_job.attempts < failed_job.max_attempts
    THEN 'pending'::message_processing_job_status
    ELSE 'dead'::message_processing_job_status
  END;

  UPDATE message_processing_jobs AS job
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
    'customer-agent-worker',
    CASE
      WHEN next_status = 'pending'
      THEN 'customer_agent.job.retry_scheduled'
      ELSE 'customer_agent.job.dead_lettered'
    END,
    'message',
    failed_job.source_message_id::text,
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

REVOKE ALL ON FUNCTION app_claim_message_processing_job(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_complete_message_processing_job(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_fail_message_processing_job(uuid, text, text, timestamptz)
  FROM PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_business_runtime') THEN
    GRANT EXECUTE ON FUNCTION app_claim_message_processing_job(text)
      TO ai_business_runtime;
    GRANT EXECUTE ON FUNCTION app_complete_message_processing_job(uuid, text)
      TO ai_business_runtime;
    GRANT EXECUTE ON FUNCTION app_fail_message_processing_job(uuid, text, text, timestamptz)
      TO ai_business_runtime;
  END IF;
END
$$;--> statement-breakpoint

COMMENT ON FUNCTION app_claim_message_processing_job(text) IS
  'Claims one due customer-agent job and reclaims stale ten-minute leases.';
COMMENT ON FUNCTION app_complete_message_processing_job(uuid, text) IS
  'Completes a customer-agent job only for the worker that owns its lease.';