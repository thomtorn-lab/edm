CREATE TABLE "discovery_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"probable_title" text NOT NULL,
	"probable_start" timestamp with time zone,
	"probable_venue_name" text,
	"source_name" text NOT NULL,
	"source_url" text NOT NULL,
	"detected_lineup" text[] DEFAULT '{}' NOT NULL,
	"predicted_genre" text,
	"genre_confidence" text DEFAULT 'low' NOT NULL,
	"suspected_duplicate_of_event_id" text,
	"missing_fields" text[] DEFAULT '{}' NOT NULL,
	"overall_confidence" text DEFAULT 'low' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_change_log" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"changed_by" text NOT NULL,
	"change_type" text NOT NULL,
	"fields_changed" text[] DEFAULT '{}' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"artists" text[] DEFAULT '{}' NOT NULL,
	"start_datetime" timestamp with time zone NOT NULL,
	"end_datetime" timestamp with time zone,
	"timezone" text DEFAULT 'Europe/Copenhagen' NOT NULL,
	"venue_id" text NOT NULL,
	"primary_genre" text NOT NULL,
	"subgenres" text[] DEFAULT '{}' NOT NULL,
	"genre_confidence" text DEFAULT 'medium' NOT NULL,
	"official_event_url" text,
	"ticket_url" text,
	"facebook_url" text,
	"resident_advisor_url" text,
	"other_source_urls" text[] DEFAULT '{}' NOT NULL,
	"image_url" text,
	"price_from" integer,
	"currency" text,
	"sold_out" boolean DEFAULT false NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"date_changed" boolean DEFAULT false NOT NULL,
	"time_changed" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"manual_override" boolean DEFAULT false NOT NULL,
	"overridden_fields" text[] DEFAULT '{}' NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"canonical_source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_source_check" timestamp with time zone,
	"last_changed" timestamp with time zone,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "source_event_links" (
	"event_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text NOT NULL,
	"role" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_event_links_event_id_source_id_role_pk" PRIMARY KEY("event_id","source_id","role")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"source_name" text NOT NULL,
	"source_type" text NOT NULL,
	"base_url" text NOT NULL,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"adapter" text,
	"trust_level" text NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"sync_frequency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_successful_sync" timestamp with time zone,
	"last_attempted_sync" timestamp with time zone,
	"last_error" text,
	"events_found" integer DEFAULT 0 NOT NULL,
	"events_updated" integer DEFAULT 0 NOT NULL,
	"integration_note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"website_url" text,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "discovery_queue" ADD CONSTRAINT "discovery_queue_suspected_duplicate_of_event_id_events_id_fk" FOREIGN KEY ("suspected_duplicate_of_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_change_log" ADD CONSTRAINT "event_change_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_canonical_source_id_sources_id_fk" FOREIGN KEY ("canonical_source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_event_links" ADD CONSTRAINT "source_event_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_event_links" ADD CONSTRAINT "source_event_links_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;