ALTER TABLE "events" ADD COLUMN "admin_unpublish_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "admin_unpublished_at" timestamp with time zone;