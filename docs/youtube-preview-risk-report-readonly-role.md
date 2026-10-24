# Read-only database role for the YouTube preview risk report

The risk report (`.github/workflows/youtube-preview-risk-report-readonly.yml`,
`src/db/youtubePreviewRiskReportCli.ts`) connects with its own Postgres role,
`report_ro`, through the GitHub secret `DATABASE_URL_REPORT_RO`. It never uses
`DATABASE_URL`.

The role can log in and SELECT from six tables. It has no other rights. Before
reading any data the report checks the role in the database catalogs
(`src/db/reportReadOnlyGuard.ts`) and stops if the role could write.

## What the report refuses

The report stops before its first data query when any of these holds:

- **Connection string:** the secret is missing, empty, not a `postgres://` or
  `postgresql://` URL, or has no user. It also stops when the user is
  Supabase's admin (`postgres` or `postgres.<project-ref>`), `supabase_admin`,
  `service_role` or `authenticator`, or when the value is identical to
  `DATABASE_URL`.
- **Role attributes:** the role has SUPERUSER, CREATEROLE, CREATEDB,
  REPLICATION or BYPASSRLS.
- **Role membership:** the role is a member of any other role, such as
  `postgres` or `pg_write_all_data`.
- **Database:** the role has CREATE on the database or owns it.
- **Tables and sequences:** the role has any write privilege on any table,
  view, materialized view, foreign table or sequence, in any non-system schema
  and not only `public`. This covers INSERT, UPDATE, DELETE, TRUNCATE,
  REFERENCES and TRIGGER, column-level grants, and sequence USAGE or UPDATE. It
  also stops when the role owns such an object.
- **Schemas:** the role has CREATE on a schema or owns one.
- **Functions:** the role can execute a function that runs with its owner's
  rights (SECURITY DEFINER), or owns a function, in a schema it can use.
- **Read access:** one of the report's tables is not readable, or row-level
  security could hide rows from it.

Two findings are only warnings:

- **`default_transaction_read_only` is off:** the report's own read-only
  transaction still applies.
- **Temporary tables:** the role can create session-local temporary tables,
  which PostgreSQL allows for PUBLIC by default. They disappear at disconnect
  and never touch stored data.

The report also keeps its own read-only transaction as a second layer:
`BEGIN READ ONLY`, a check that `transaction_read_only` is `on`, SELECT-only
queries and `ROLLBACK`.

These checks were run against a local PostgreSQL 16 database built from this
repository's migrations, with a Supabase-like non-superuser `postgres` admin. A
role made with step 2 below passed. Each unsafe variant was refused: SUPERUSER,
BYPASSRLS, membership of `postgres` or `pg_write_all_data`, a table, column or
sequence grant, CREATE on a schema or the database, an owned table, a SECURITY
DEFINER function executable by PUBLIC, and row-level security without an open
policy. Logged in as `report_ro`, `DELETE`, `UPDATE` and `CREATE TABLE` all
failed with `permission denied`, even with `default_transaction_read_only`
switched off.

## Steps for the owner

All SQL runs in the Supabase dashboard, in **SQL Editor** of the Production
project. The editor runs as the project's admin role, which is allowed to
create roles.

### 1. Pre-check (read only)

```sql
-- a) Functions that run with their owner's rights and that every role may call.
--    The report refuses to run while any are listed (see "If the report refuses").
SELECT n.nspname AS schema, p.proname AS function
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND has_function_privilege('public', p.oid, 'EXECUTE')
  AND (n.nspname IN ('public', 'drizzle') OR has_schema_privilege('public', n.oid, 'USAGE'))
ORDER BY 1, 2;

-- b) Row-level security on the report's tables (expected: false everywhere).
SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname, c.relname) IN (('public', 'artist_youtube_preview_cache'), ('public', 'events'),
  ('public', 'discovery_queue'), ('public', 'source_event_links'),
  ('public', 'event_youtube_preview_overrides'), ('drizzle', '__drizzle_migrations'));
```

Query b) must list all six tables. If `event_youtube_preview_overrides` is
missing, migration 0023 has not been applied. In that case, remove that table
from the GRANT in step 2.

### 2. Create the role

First generate the password in the same editor, from PostgreSQL's built-in
cryptographic random generator. The editor shows the value only in your
browser.

```sql
SELECT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') AS password;
```

Copy the 64-character value. Hex needs no URL escaping. Replace
`<PASSWORD>` below with it, then run:

```sql
CREATE ROLE report_ro WITH LOGIN PASSWORD '<PASSWORD>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 2;
ALTER ROLE report_ro SET default_transaction_read_only = on;
ALTER ROLE report_ro SET statement_timeout = '30s';

GRANT USAGE ON SCHEMA public, drizzle TO report_ro;
GRANT SELECT ON
  public.artist_youtube_preview_cache,
  public.events,
  public.discovery_queue,
  public.source_event_links,
  public.event_youtube_preview_overrides,
  drizzle.__drizzle_migrations
TO report_ro;
```

Then clear the editor, so the password does not stay in a saved snippet.

Nothing else is granted. Supabase's default privileges for new tables go to
`anon`, `authenticated` and `service_role`, not to `report_ro`. Tables created
later are therefore not readable by it.

### 3. Build the connection string

In the dashboard, open **Connect** and choose the same pooler connection that
the existing `DATABASE_URL` uses. For Production that is the transaction
pooler on `aws-1-eu-west-3.pooler.supabase.com:6543`. Change only the user and
the password:

```
postgresql://report_ro.<project-ref>:<PASSWORD>@aws-1-eu-west-3.pooler.supabase.com:6543/postgres
```

The pooler user is `report_ro.<project-ref>`, where `<project-ref>` is the same
suffix as in the existing `postgres.<project-ref>`. If the existing
`DATABASE_URL` ends with query parameters (for example `?sslmode=...`), keep
the same ones.

### 4. Store it as a GitHub secret

1. In GitHub, open **thomtorn-lab/edm → Settings → Secrets and variables →
   Actions → Secrets → New repository secret**.
2. Set **Name** to `DATABASE_URL_REPORT_RO`.
3. Paste the connection string from step 3 as the **Secret**, and save.

Do not paste the value anywhere else: not in chat, an issue, a commit or a
workflow file. GitHub encrypts it and masks the value in run logs. The
workflow only checks whether it is empty. The report never prints it, and
its error messages name the variable but never its value, which the tests
check.

### 5. After the run

```sql
ALTER ROLE report_ro NOLOGIN;  -- keeps the grants for a later run
```

To remove it completely:

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public, drizzle FROM report_ro;
REVOKE USAGE ON SCHEMA public, drizzle FROM report_ro;
DROP ROLE report_ro;
```

Also delete the GitHub secret.

## If the report refuses

The run ends with `Refusing to run: database role … is not proven read-only:`
followed by every finding. Nothing has been read at that point.

- **Admin or wrong user:** the connection string uses the wrong user. Redo
  step 3.
- **Owner-rights functions:** fixing this would mean revoking `EXECUTE` from
  PUBLIC on those functions. That can affect the app's other roles, so it is a
  decision to review first. Do not do it just to unblock the report.
- **Row-level security:** create one policy per listed table, for example
  `CREATE POLICY report_ro_read ON public.events FOR SELECT TO report_ro USING (true);`.
  The table must have no restrictive policy.
