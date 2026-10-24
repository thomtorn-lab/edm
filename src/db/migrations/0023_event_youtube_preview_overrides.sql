CREATE TABLE "event_youtube_preview_overrides" (
	"event_id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"video_id" text,
	"video_title" text,
	"channel_id" text,
	"channel_title" text,
	"artist_name" text,
	"available" boolean DEFAULT true NOT NULL,
	"last_verified_at" timestamp with time zone,
	"unavailable_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_youtube_preview_overrides" ADD CONSTRAINT "event_youtube_preview_overrides_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;