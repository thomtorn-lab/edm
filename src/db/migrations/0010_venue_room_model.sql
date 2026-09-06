ALTER TABLE "discovery_queue" ADD COLUMN "probable_sub_venue" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "sub_venue" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "rooms" jsonb DEFAULT '[]'::jsonb NOT NULL;