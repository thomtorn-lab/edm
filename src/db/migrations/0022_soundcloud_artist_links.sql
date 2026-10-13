CREATE TABLE "event_soundcloud_links" (
	"event_id" text NOT NULL,
	"source_id" text NOT NULL,
	"artist_name" text NOT NULL,
	"url" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_soundcloud_links_event_id_source_id_artist_name_pk" PRIMARY KEY("event_id","source_id","artist_name")
);
--> statement-breakpoint
CREATE TABLE "soundcloud_link_blocks" (
	"url" text PRIMARY KEY NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_soundcloud_links" ADD CONSTRAINT "event_soundcloud_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_soundcloud_links" ADD CONSTRAINT "event_soundcloud_links_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;