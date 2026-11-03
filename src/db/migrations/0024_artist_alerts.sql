CREATE TABLE "alert_deliveries" (
	"subscriber_id" text NOT NULL,
	"event_id" text NOT NULL,
	"artist_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"email_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_deliveries_subscriber_id_event_id_pk" PRIMARY KEY("subscriber_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "alert_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text_body" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"resend_email_id" text,
	"first_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_follows" (
	"subscriber_id" text NOT NULL,
	"artist_id" text NOT NULL,
	"active_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_follows_subscriber_id_artist_id_pk" PRIMARY KEY("subscriber_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "alert_subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"confirm_token_hash" text,
	"manage_token_hash" text NOT NULL,
	"consent_version" text,
	"confirmed_at" timestamp with time zone,
	"confirm_emails_sent" integer DEFAULT 0 NOT NULL,
	"last_confirm_email_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_subscribers_email_unique" UNIQUE("email"),
	CONSTRAINT "alert_subscribers_confirm_token_hash_unique" UNIQUE("confirm_token_hash"),
	CONSTRAINT "alert_subscribers_manage_token_hash_unique" UNIQUE("manage_token_hash")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"name_key" text NOT NULL,
	"status" text DEFAULT 'auto' NOT NULL,
	"profile_url" text,
	"disambiguation" text,
	"merged_into_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_artists" (
	"event_id" text NOT NULL,
	"name_key" text NOT NULL,
	"artist_id" text,
	"lineup_entry" text NOT NULL,
	"display_name" text NOT NULL,
	"confidence" text NOT NULL,
	"reason" text,
	"visible_since" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_artists_event_id_name_key_pk" PRIMARY KEY("event_id","name_key")
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_subscriber_id_alert_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."alert_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_emails" ADD CONSTRAINT "alert_emails_subscriber_id_alert_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."alert_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_follows" ADD CONSTRAINT "alert_follows_subscriber_id_alert_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."alert_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_follows" ADD CONSTRAINT "alert_follows_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_follows_artist_idx" ON "alert_follows" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "artists_name_key_idx" ON "artists" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "event_artists_artist_idx" ON "event_artists" USING btree ("artist_id");