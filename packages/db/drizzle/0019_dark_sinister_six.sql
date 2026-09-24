CREATE TYPE "public"."instagram_connection_status" AS ENUM('active', 'disabled', 'reauthorization_required');--> statement-breakpoint
CREATE TABLE "instagram_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"instagram_account_id" text NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"access_token_iv" text NOT NULL,
	"access_token_auth_tag" text NOT NULL,
	"encryption_key_version" integer DEFAULT 1 NOT NULL,
	"token_fingerprint" text NOT NULL,
	"status" "instagram_connection_status" DEFAULT 'active' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_accounts_account_id_numeric" CHECK ("instagram_accounts"."instagram_account_id" ~ '^[0-9]{1,80}$'),
	CONSTRAINT "instagram_accounts_ciphertext_not_blank" CHECK (length(trim("instagram_accounts"."access_token_ciphertext")) > 0),
	CONSTRAINT "instagram_accounts_iv_not_blank" CHECK (length(trim("instagram_accounts"."access_token_iv")) > 0),
	CONSTRAINT "instagram_accounts_auth_tag_not_blank" CHECK (length(trim("instagram_accounts"."access_token_auth_tag")) > 0),
	CONSTRAINT "instagram_accounts_key_version_positive" CHECK ("instagram_accounts"."encryption_key_version" > 0),
	CONSTRAINT "instagram_accounts_fingerprint_shape" CHECK ("instagram_accounts"."token_fingerprint" ~ '^[a-f0-9]{16}$')
);
--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_accounts_tenant_uq" ON "instagram_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_accounts_account_uq" ON "instagram_accounts" USING btree ("instagram_account_id");--> statement-breakpoint

ALTER TABLE "instagram_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "instagram_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "instagram_accounts_owner_isolation" ON "instagram_accounts"
  USING (
    "tenant_id" = app_current_tenant_id()
    AND app_current_membership_role("tenant_id") = 'owner'
  )
  WITH CHECK (
    "tenant_id" = app_current_tenant_id()
    AND app_current_membership_role("tenant_id") = 'owner'
  );--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_business_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "instagram_accounts" TO ai_business_runtime;
  END IF;
END
$$;--> statement-breakpoint

COMMENT ON TABLE "instagram_accounts" IS
  'One owner-managed Instagram professional account connection per tenant.';
COMMENT ON COLUMN "instagram_accounts"."access_token_ciphertext" IS
  'AES-256-GCM ciphertext; plaintext access tokens must never be stored.';
COMMENT ON COLUMN "instagram_accounts"."token_fingerprint" IS
  'Non-secret truncated SHA-256 fingerprint for credential rotation diagnostics.';