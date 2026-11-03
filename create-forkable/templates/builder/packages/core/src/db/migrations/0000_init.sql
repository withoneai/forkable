CREATE TABLE "activity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform" text,
	"action_id" text,
	"title" text,
	"method" text,
	"path" text,
	"source" text NOT NULL,
	"status" integer,
	"ok" boolean,
	"blocked_by_grant" boolean,
	"refusal" jsonb,
	"ms" integer,
	"turn_id" text
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"sha" text NOT NULL,
	"project_id" text NOT NULL,
	"turn_id" text,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"harness" text,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"shot" text,
	"bookmarked" boolean DEFAULT false NOT NULL,
	"restored_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkpoints_project_id_sha_pk" PRIMARY KEY("project_id","sha")
);
--> statement-breakpoint
CREATE TABLE "connect_users" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"connect_user_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "errors" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"signature" text NOT NULL,
	"source" text NOT NULL,
	"severity" text DEFAULT 'error' NOT NULL,
	"file" text,
	"line" integer,
	"col" integer,
	"message" text NOT NULL,
	"stack" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"turn_id" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"template_version" text NOT NULL,
	"harness" text NOT NULL,
	"model" text,
	"permission" text DEFAULT 'build' NOT NULL,
	"auto_fix" boolean DEFAULT true NOT NULL,
	"dev_port" integer,
	"relay_token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "publishes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"target" text NOT NULL,
	"sha" text NOT NULL,
	"status" text NOT NULL,
	"url" text,
	"repo" text,
	"scan" jsonb,
	"manifest_hash" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb
);
--> statement-breakpoint
CREATE TABLE "turn_events" (
	"turn_id" text NOT NULL,
	"seq" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_events_turn_id_seq_pk" PRIMARY KEY("turn_id","seq")
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"parent_turn_id" text,
	"fix_attempt" integer DEFAULT 0 NOT NULL,
	"prompt" text NOT NULL,
	"selections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"harness" text NOT NULL,
	"model" text,
	"session_id" text,
	"status" text NOT NULL,
	"exit" text,
	"error" text,
	"usage" jsonb DEFAULT '{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}'::jsonb NOT NULL,
	"cost_usd" double precision,
	"text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"checkpoint_sha" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"one_user_id" text,
	"email" text,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "activity_project" ON "activity" USING btree ("project_id","at");--> statement-breakpoint
CREATE INDEX "errors_project" ON "errors" USING btree ("project_id","signature");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "turns_project" ON "turns" USING btree ("project_id","created_at");