CREATE TABLE "event_admin_soundcloud_links" (
	"event_id" text NOT NULL,
	"artist_name" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_admin_soundcloud_links_event_id_artist_name_pk" PRIMARY KEY("event_id","artist_name")
);
--> statement-breakpoint
ALTER TABLE "event_admin_soundcloud_links" ADD CONSTRAINT "event_admin_soundcloud_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
