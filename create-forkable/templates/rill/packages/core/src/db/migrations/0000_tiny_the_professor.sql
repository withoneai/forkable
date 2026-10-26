CREATE TABLE "briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"mailbox_id" text NOT NULL,
	"for_date" text NOT NULL,
	"kpis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"engine" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect_users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"connect_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"reply_to_message_id" text,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"engine" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"gmail_draft_id" text,
	"validator" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"mailbox_id" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"weight" integer DEFAULT 5 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judgments" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"question" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"answer" text NOT NULL,
	"probability" real NOT NULL,
	"confidence" real NOT NULL,
	"probabilities" jsonb,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox_id" text,
	"user_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform" text NOT NULL,
	"action" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"mode" text NOT NULL,
	"level" text NOT NULL,
	"status" integer NOT NULL,
	"ok" boolean NOT NULL,
	"blocked_by_grant" boolean DEFAULT false NOT NULL,
	"refusal" text,
	"engine" text,
	"model" text,
	"ms" integer DEFAULT 0 NOT NULL,
	"summary" text NOT NULL,
	"note" text,
	"cost_usd" real
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"mode" text NOT NULL,
	"connection_key" text,
	"address" text,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"gmail_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"raw_body" text,
	"hidden_text" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_from_me" boolean DEFAULT false NOT NULL,
	"message_id_header" text,
	"judged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"mailbox_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"i_wrote_to_them" boolean DEFAULT false NOT NULL,
	CONSTRAINT "senders_mailbox_id_email_pk" PRIMARY KEY("mailbox_id","email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"mailbox_id" text PRIMARY KEY NOT NULL,
	"writer_engine" text,
	"writer_provider" text,
	"writer_model" text,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brief_time" text DEFAULT '07:30' NOT NULL,
	"timezone" text,
	"allow_writes" boolean DEFAULT false NOT NULL,
	"apply_labels" boolean DEFAULT true NOT NULL,
	"auto_draft" boolean DEFAULT true NOT NULL,
	"onboarded" boolean DEFAULT false NOT NULL,
	"me" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_state" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"mailbox_id" text NOT NULL,
	"lane" text NOT NULL,
	"rule" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"check" boolean DEFAULT false NOT NULL,
	"goal_id" text,
	"vip_id" text,
	"needs_reply" boolean DEFAULT false NOT NULL,
	"ball" text,
	"urgency" integer DEFAULT 0 NOT NULL,
	"kind" text,
	"screen" text DEFAULT 'pass' NOT NULL,
	"summary" text,
	"ask" text,
	"done" boolean DEFAULT false NOT NULL,
	"done_reason" text,
	"snoozed_until" timestamp with time zone,
	"reply_later" boolean DEFAULT false NOT NULL,
	"follow_up_at" timestamp with time zone,
	"judged_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"gmail_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"subject" text NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 1 NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"history_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"one_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vips" (
	"id" text PRIMARY KEY NOT NULL,
	"mailbox_id" text NOT NULL,
	"name" text NOT NULL,
	"match_kind" text NOT NULL,
	"match" text NOT NULL,
	"tier" text DEFAULT 'key' NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connect_users" ADD CONSTRAINT "connect_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgments" ADD CONSTRAINT "judgments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_state" ADD CONSTRAINT "thread_state_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vips" ADD CONSTRAINT "vips_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "briefs_mailbox_date_idx" ON "briefs" USING btree ("mailbox_id","for_date");--> statement-breakpoint
CREATE INDEX "connect_users_cu_idx" ON "connect_users" USING btree ("connect_user_id");--> statement-breakpoint
CREATE INDEX "drafts_thread_idx" ON "drafts" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "judgments_message_idx" ON "judgments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "ledger_mailbox_idx" ON "ledger" USING btree ("mailbox_id","at");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","date");--> statement-breakpoint
CREATE INDEX "messages_mailbox_idx" ON "messages" USING btree ("mailbox_id","judged_at");--> statement-breakpoint
CREATE INDEX "thread_state_lane_idx" ON "thread_state" USING btree ("mailbox_id","lane","done");--> statement-breakpoint
CREATE INDEX "threads_mailbox_idx" ON "threads" USING btree ("mailbox_id","last_message_at");