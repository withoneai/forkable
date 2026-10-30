ALTER TABLE "settings" ADD COLUMN "mail_categories" jsonb DEFAULT '["primary"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_state" ADD COLUMN "check_reason" text;--> statement-breakpoint
ALTER TABLE "thread_state" ADD COLUMN "follow_up_shown_at" timestamp with time zone;--> statement-breakpoint
UPDATE "settings" SET "mail_categories" = '["primary","promotions","updates","social","forums"]'::jsonb WHERE "mailbox_id" IN (SELECT "id" FROM "mailboxes" WHERE "source" = 'sample');
