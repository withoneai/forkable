CREATE TABLE "booking_links" (
	"id" text PRIMARY KEY NOT NULL,
	"mailbox_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"provider" text NOT NULL,
	"connection_key" text,
	"name" text NOT NULL,
	"color" text,
	"shown" boolean DEFAULT true NOT NULL,
	"counts_for_availability" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"access_role" text DEFAULT 'owner' NOT NULL,
	"sync_state" text DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_threads" (
	"event_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_threads_event_id_thread_id_pk" PRIMARY KEY("event_id","thread_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"ical_uid" text,
	"recurring_event_id" text,
	"title" text DEFAULT '(no title)' NOT NULL,
	"description" text,
	"location" text,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"time_zone" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"organizer" jsonb,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"join_url" text,
	"my_response" text DEFAULT 'needsAction' NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_from" jsonb,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "mail_provider" text DEFAULT 'gmail' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "calendar_provider" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "calendar_connection_key" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "calendar_sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "calendar_last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secondary_timezone" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "working_hours" jsonb DEFAULT '{"days":[1,2,3,4,5],"startMinute":540,"endMinute":1080}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_calendar_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "today_rail" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_threads" ADD CONSTRAINT "event_threads_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_threads" ADD CONSTRAINT "event_threads_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_links_slug_idx" ON "booking_links" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "calendars_mailbox_idx" ON "calendars" USING btree ("mailbox_id");--> statement-breakpoint
CREATE INDEX "event_threads_thread_idx" ON "event_threads" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "events_calendar_idx" ON "events" USING btree ("calendar_id","start");--> statement-breakpoint
CREATE INDEX "events_mailbox_idx" ON "events" USING btree ("mailbox_id","start");--> statement-breakpoint
CREATE INDEX "events_ical_uid_idx" ON "events" USING btree ("ical_uid");