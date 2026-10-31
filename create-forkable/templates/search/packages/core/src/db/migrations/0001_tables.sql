CREATE TABLE "catalog_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"etag" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"context" jsonb,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposal" jsonb,
	"followups" text[] DEFAULT '{}'::text[] NOT NULL,
	"model" text,
	"grounded" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"user_id" text NOT NULL,
	"ord" integer NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"tokens" integer NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
--> statement-breakpoint
CREATE TABLE "classifications" (
	"item_id" text NOT NULL,
	"user_id" text NOT NULL,
	"question_set" text NOT NULL,
	"body_hash" text NOT NULL,
	"model" text NOT NULL,
	"answers" jsonb NOT NULL,
	"kind_guess" text,
	"importance" real,
	"lane" text,
	"needs_you" real,
	"judged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classifications_item_id_question_set_pk" PRIMARY KEY("item_id","question_set")
);
--> statement-breakpoint
CREATE TABLE "connect_users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"connect_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"primary_email" text,
	"domain" text,
	"title" text,
	"company_id" text,
	"avatar_url" text,
	"is_self" boolean DEFAULT false NOT NULL,
	"merged_into_id" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', search_unaccent(coalesce(name, '') || ' ' || coalesce(primary_email, '') || ' ' || coalesce(domain, '')))) STORED
);
--> statement-breakpoint
CREATE TABLE "entity_keys" (
	"entity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_links" (
	"item_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"role" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "entity_links_item_id_entity_id_role_pk" PRIMARY KEY("item_id","entity_id","role")
);
--> statement-breakpoint
CREATE TABLE "entity_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"a_id" text NOT NULL,
	"b_id" text NOT NULL,
	"reason" text NOT NULL,
	"probability" real,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_errors" (
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"stage" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_errors_source_id_external_id_stage_pk" PRIMARY KEY("source_id","external_id","stage")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_id" text NOT NULL,
	"raw_item_id" text NOT NULL,
	"external_id" text NOT NULL,
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"snippet" text,
	"url" text,
	"container" text,
	"group_key" text,
	"status" text,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"facets" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"map_hash" text NOT NULL,
	"body_hash" text NOT NULL,
	"importance" real,
	"lane" text,
	"directory" boolean DEFAULT false NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', search_unaccent(coalesce(title, ''))), 'A') || setweight(to_tsvector('english', coalesce(container, '') || ' ' || coalesce(search_labels_text(labels), '')), 'C') || setweight(to_tsvector('english', left(coalesce(body, ''), 100000)), 'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_id" text,
	"actor" text NOT NULL,
	"client_id" text,
	"platform" text NOT NULL,
	"action" text NOT NULL,
	"action_id" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"mode" text NOT NULL,
	"level" text NOT NULL,
	"status" integer NOT NULL,
	"ok" boolean NOT NULL,
	"blocked_by_grant" boolean DEFAULT false NOT NULL,
	"refusal" text,
	"ms" integer DEFAULT 0 NOT NULL,
	"summary" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_secret_hash" text,
	"client_name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"token_endpoint_auth_method" text NOT NULL,
	"grant_types" jsonb NOT NULL,
	"scope" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_pending" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text DEFAULT 'S256' NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"family_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pending_embeddings" (
	"chunk_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"model" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"step" text DEFAULT 'platform' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposal" jsonb,
	"edits" jsonb DEFAULT '{"selected":[],"profiles":{}}'::jsonb NOT NULL,
	"validation" jsonb,
	"model" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"fetch_hash" text NOT NULL,
	"map_hash" text NOT NULL,
	"index_hash" text NOT NULL,
	"profile_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"slug" text NOT NULL,
	"platform" text NOT NULL,
	"model" text NOT NULL,
	"origin" text NOT NULL,
	"origin_url" text,
	"current_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_slug_uq" UNIQUE NULLS NOT DISTINCT("user_id","slug")
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"partition_key" text DEFAULT '' NOT NULL,
	"item" jsonb NOT NULL,
	"detail" jsonb,
	"children" jsonb,
	"partition" jsonb,
	"fingerprint" text,
	"fetch_hash" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recent_searches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"query" text NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"trigger" text NOT NULL,
	"full_pass" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text DEFAULT 'running' NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"hydrated" integer DEFAULT 0 NOT NULL,
	"upserted" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"tombstoned" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"http_status" integer,
	"retry_after_at" timestamp with time zone,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "self_addresses" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"source_id" text,
	CONSTRAINT "self_addresses_user_id_kind_value_pk" PRIMARY KEY("user_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_cursors" (
	"source_id" text NOT NULL,
	"partition_key" text DEFAULT '' NOT NULL,
	"watermark" text,
	"delta_token" text,
	"page_cursor" jsonb,
	"pending_watermark" text,
	"last_full_pass_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_cursors_source_id_partition_key_pk" PRIMARY KEY("source_id","partition_key")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"connection_key" text NOT NULL,
	"connection_label" text NOT NULL,
	"profile_id" text NOT NULL,
	"profile_version_id" text NOT NULL,
	"fetch_hash" text,
	"map_hash" text,
	"index_hash" text,
	"mode" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"account_vars" jsonb,
	"account_vars_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule_every" integer NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_full_pass_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"last_error" jsonb,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"one_user_id" text,
	"avatar_url" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_messages_chat_idx" ON "chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chats_user_idx" ON "chats" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_uq" ON "chunks" USING btree ("item_id","ord");--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_hash_idx" ON "chunks" USING btree ("text_hash");--> statement-breakpoint
CREATE INDEX "connect_users_cu_idx" ON "connect_users" USING btree ("connect_user_id");--> statement-breakpoint
CREATE INDEX "entities_user_idx" ON "entities" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "entities_tsv_idx" ON "entities" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_keys_uq" ON "entity_keys" USING btree ("user_id","key") WHERE "entity_keys"."key" not like 'name:%';--> statement-breakpoint
CREATE INDEX "entity_keys_entity_idx" ON "entity_keys" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_keys_key_idx" ON "entity_keys" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "entity_links_entity_idx" ON "entity_links" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_matches_uq" ON "entity_matches" USING btree ("user_id","a_id","b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_uq" ON "items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "items_tsv_idx" ON "items" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "items_user_kind_idx" ON "items" USING btree ("user_id","kind","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "items_user_platform_idx" ON "items" USING btree ("user_id","platform");--> statement-breakpoint
CREATE INDEX "items_labels_idx" ON "items" USING gin ("labels");--> statement-breakpoint
CREATE INDEX "items_facets_idx" ON "items" USING gin ("facets" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "ledger_user_idx" ON "ledger" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "ledger_source_idx" ON "ledger" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_user_idx" ON "oauth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_family_idx" ON "oauth_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "pending_embeddings_next_idx" ON "pending_embeddings" USING btree ("user_id","next_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_versions_uq" ON "profile_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_uq" ON "raw_items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "recent_searches_user_idx" ON "recent_searches" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "runs_source_idx" ON "runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "saved_searches_user_idx" ON "saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_uq" ON "sources" USING btree ("user_id","connection_key","profile_id");--> statement-breakpoint
CREATE INDEX "sources_due_idx" ON "sources" USING btree ("next_run_at");