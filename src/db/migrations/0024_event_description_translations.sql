CREATE TABLE "event_description_translations" (
	"event_id" text PRIMARY KEY NOT NULL,
	"source_hash" text NOT NULL,
	"status" text NOT NULL,
	"source_language" text,
	"translated_text" text,
	"model" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"review_reason" text,
	"removed_duplicate_lines" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_description_translations" ADD CONSTRAINT "event_description_translations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;