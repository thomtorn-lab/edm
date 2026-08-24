ALTER TABLE "discovery_queue" ADD COLUMN "probable_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discovery_queue" ADD COLUMN "probable_ticket_url" text;--> statement-breakpoint
ALTER TABLE "discovery_queue" ADD COLUMN "probable_free" boolean DEFAULT false NOT NULL;