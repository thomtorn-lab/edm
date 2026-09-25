CREATE TABLE "artist_youtube_preview_cache" (
	"artist_name_normalized" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'youtube' NOT NULL,
	"status" text NOT NULL,
	"match_rule" text,
	"query" text NOT NULL,
	"video_id" text,
	"video_title" text,
	"channel_id" text,
	"channel_title" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manual_block" boolean DEFAULT false NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
