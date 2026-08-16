CREATE TABLE "artist_genre_cache" (
	"artist_name_normalized" text PRIMARY KEY NOT NULL,
	"lookup_status" text NOT NULL,
	"proposed_genre" text,
	"genre_confidence" text,
	"identity_confidence" text,
	"discogs_artist_id" integer,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"classification_method" text NOT NULL,
	"looked_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
