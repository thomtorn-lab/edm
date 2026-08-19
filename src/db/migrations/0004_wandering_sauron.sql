CREATE TABLE "sync_locks" (
	"source_id" text PRIMARY KEY NOT NULL,
	"lock_token" text NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
