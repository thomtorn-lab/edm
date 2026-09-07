ALTER TABLE "events" ADD COLUMN "source_cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_cancelled_by_source_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_cancellation_evidence" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_source_cancelled_by_source_id_sources_id_fk" FOREIGN KEY ("source_cancelled_by_source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;