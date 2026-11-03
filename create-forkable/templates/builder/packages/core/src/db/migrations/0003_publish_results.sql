ALTER TABLE "publishes" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "publishes" ADD COLUMN "options" jsonb;--> statement-breakpoint
ALTER TABLE "publishes" ADD COLUMN "steps" jsonb;--> statement-breakpoint
ALTER TABLE "publishes" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "publishes" ADD COLUMN "grant" text;