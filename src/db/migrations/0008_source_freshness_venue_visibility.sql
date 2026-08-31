ALTER TABLE "discovery_queue" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_complete_sync_at" timestamp with time zone;