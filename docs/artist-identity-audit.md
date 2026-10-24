# Artist identity audit (read-only)

One-off report for Artist Alerts, Phase A step 1. It measures how far
Production's lineup data can support artist alerts before any table, job or
alert exists. Nothing in it writes, calls an external service or reads
subscriber or newsletter data.

- Logic: `src/lib/artistIdentity/lineupIdentity.ts` (rules) and
  `src/db/artistIdentityAudit.ts` (report).
- CLI: `src/db/artistIdentityAuditCli.ts`.
- Run: `inspect-source.yml` with mode `artist-identity-audit`. The JSON report
  is uploaded as the `artist-identity-audit` artifact and kept for 14 days.
  Mode `artist-identity-audit-check` only proves the connection and role and
  reads no data row.

## Connection safety

The mode never receives `DATABASE_URL`. It reads only the secret
`DATABASE_URL_REPORT_RO`, the shared reporting role `report_ro`. It uses the
shared guard `src/db/reportReadOnlyGuard.ts`, a byte-identical copy of #141's
commit cdc6985. Replace the copy with the shared module once that is on main.
Setting up the role, including the pre-check for SECURITY DEFINER functions,
is described in one place: #141's
`docs/youtube-preview-risk-report-readonly-role.md`. Its GRANT covers all
twelve shared tables, these eight included.

Before the first data query the CLI:

1. opens `BEGIN READ ONLY` and verifies `transaction_read_only = on`;
2. proves from the catalogs that the role cannot write anywhere. The rules are
   #141's: no elevated attributes, no role membership, no write or ownership
   on any table, sequence, schema or the database, and no executable SECURITY
   DEFINER function;
3. proves SELECT on each of its eight tables, with no row-level security that
   could hide rows.

Any failure stops the run. It always ends with `ROLLBACK`. The session is
also bounded before the first catalog query: `statement_timeout` 60s,
`lock_timeout` 5s (so it never queues behind a migration's lock), and
`idle_in_transaction_session_timeout` 120s. The workflow step has a
10-minute limit, and the workflow token is `contents: read`.

## One shared reporting role (owner decision 2026-10-24)

Every read-only audit uses the same credential, `DATABASE_URL_REPORT_RO`,
and the same role, `report_ro`. The role holds SELECT on the union of tables
the approved audits read, and nothing else: no write, schema or ownership
rights, and no newsletter tables. Each audit passes its own table list to
the guard, so a report can rely only on the tables it declares.

## Grants the reporting role needs

The role needs SELECT, and nothing else, on:

`events`, `venues`, `sources`, `event_soundcloud_links`,
`soundcloud_link_blocks`, `artist_genre_cache`, `event_change_log`,
`discovery_queue`

`events` and `discovery_queue` are already granted for #141. The owner adds
the other six with one additive statement in Supabase's SQL editor, as the
admin. The owner runs it; no workflow runs it:

```sql
GRANT SELECT ON public.venues, public.sources, public.event_soundcloud_links,
  public.soundcloud_link_blocks, public.artist_genre_cache, public.event_change_log
  TO report_ro;
```

None of these tables holds personal data. Never grant the reporting role
access to `newsletter_subscribers` or `newsletter_sends`.

Known limit: the guard refuses (fail-closed) if the role can execute a
SECURITY DEFINER function in any schema it can use. Supabase ships such
functions in its own schemas (for example `extensions`, `graphql`). If one is
usable through a PUBLIC grant, the first run stops at the guard before any
data query. That is safe, but the owner then has to decide how to narrow the
role's schema access.

## Reading the report

Every section has a `basis`:

- `observed`: counted from stored rows.
- `estimated`: derived from stored rows through the stated assumption.
- `undeterminable`: cannot be decided from stored data. Examples are two
  different artists with the same name and no source handle, and lineup
  additions versus removals (the change log keeps no old or new values).
