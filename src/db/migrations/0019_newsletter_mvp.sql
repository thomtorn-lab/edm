CREATE TABLE "newsletter_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"iso_week" text NOT NULL,
	"subscriber_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recipient_email" text NOT NULL,
	"manage_token" text NOT NULL,
	"payload_subject" text,
	"payload_html" text,
	"payload_text" text,
	"event_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"resend_email_id" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	CONSTRAINT "newsletter_sends_iso_week_subscriber_id_unique" UNIQUE("iso_week","subscriber_id")
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"confirm_token" text NOT NULL,
	"manage_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email"),
	CONSTRAINT "newsletter_subscribers_confirm_token_unique" UNIQUE("confirm_token"),
	CONSTRAINT "newsletter_subscribers_manage_token_unique" UNIQUE("manage_token")
);
--> statement-breakpoint
ALTER TABLE "newsletter_sends" ADD CONSTRAINT "newsletter_sends_subscriber_id_newsletter_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."newsletter_subscribers"("id") ON DELETE cascade ON UPDATE no action;