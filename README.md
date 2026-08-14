# Nattefrekvens — Copenhagen electronic music events

A fast, curated, largely self-maintaining index of electronic music events in Copenhagen &
Frederiksberg. See the product brief this was built against for full requirements; this file
covers what's implemented, how it's organised, and what's intentionally left for later phases.

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS v4 + Postgres (Drizzle ORM).

```bash
cp .env.example .env.local   # point DATABASE_URL at a local/hosted Postgres
npm install
npm run db:migrate   # apply the schema
npm run db:seed      # load sample venues/sources/events (idempotent)
npm run dev           # http://localhost:3000
npm run test           # vitest — datetime, dedup, normalization, classification, ICS export, sync
npm run build            # production build (all routes are statically generated except /api/*)
npm run lint
npm run db:verify-sync    # end-to-end proof: live-fetches Hangaren + exercises every sync scenario against Postgres
```

## Current phase

Phase 1 (visual/product proof), Phase 2 (taxonomy, venue registry, dedup/normalization, source
registry, adapter architecture), a real persistent Postgres database with a real admin write path
and field-level manual-override protection, and **one real, live, working first-party ingestion
source (Hangaren)** are all implemented and wired end to end: adapter → extraction → validation →
normalization → dedup → genre classification → confidence gate → database → public site →
subsequent source update, running **on an actual schedule** (`.github/workflows/sync-hangaren.yml`,
every 6h — see "Scheduling" below) rather than only being triggerable by hand. `/admin` and
`/api/admin/*` are gated behind HTTP Basic Auth (see "Admin access" below) — not publicly writable.
`src/lib/data/*.ts` is no longer read by the running app — it's the seed source for `npm run
db:seed` and fixture data for pure-logic unit tests. The other three first-party venues (Culture
Box, Gravity, Den Anden Side) are evaluated in `src/lib/data/sources.ts`'s `integrationNote` per
source but do not have a working adapter yet — see that file before adding one.

## Architecture

```
src/lib/
  types.ts            Canonical data model (Event, Venue, Source, DiscoveryQueueItem…)
  taxonomy.ts          Controlled subgenre taxonomy + homepage display-label logic
  datetime.ts           Nightlife-aware date logic (Europe/Copenhagen, 06:00 cutoff) — see below
  format.ts             Display formatting built on datetime.ts
  normalize.ts           Venue alias resolution + artist name normalization
  dedup.ts                Fuzzy duplicate detection across sources
  classification.ts        Genre evidence hierarchy, quality gate, canonical source priority
  search.ts                 Free-text search over title/artists/venue/subgenre
  links.ts                   External link dedup + CTA priority
  ics.ts                      Calendar export (ICS + Google + Outlook), DST-safe
  jsonld.ts                    schema.org MusicEvent structured data
  queries.ts                    Data-access layer, backed by Postgres (src/db)
  sourceHealth.ts                Source registry health classification
  sync.ts                         Pure sync-time merge decisions: does a candidate match an
                                   already-known event (linked/fuzzy), and if so what actually
                                   changed (buildSyncPatch — dateChanged/timeChanged flags, etc.)
  data/                            Seed fixtures for `npm run db:seed` + pure-logic unit tests
  adapters/
    types.ts                        RawCandidateEvent — the shape every adapter must produce
    firstPartyAdapter.ts              Generic reference adapter for a first-party JSON feed
    hangarenAdapter.ts                 Real, working adapter — live HTML fetch + parse (see below)
    deterministicGenreMapping.ts       Keyword fallback — evidence tier 5, never tier 1
    pipeline.ts                         EXTRACTION → VALIDATION → NORMALIZATION → DEDUP →
                                         CLASSIFICATION → CONFIDENCE → PUBLISH/REVIEW, as pure
                                         functions. Adapters only ever produce RawCandidateEvent;
                                         everything downstream is adapter-agnostic.
src/db/
  schema.ts / client.ts / mappers.ts  Drizzle schema, pooled connection, DB-row <-> app-type mapping
  writes.ts                            All admin/sync writes — the enforcement point for override
                                        protection (applySourceSyncPatch strips overridden fields)
  sync.ts                               runSourceSync(): orchestrates one full sync run for one
                                         source — fetch, pipeline, match-or-create, write, with
                                         source-failure and zero-events handled as distinct,
                                         never-silent, never-a-cancellation outcomes
  verifySync.ts                         `npm run db:verify-sync` — end-to-end proof against a real
                                         Postgres database (see "Hangaren ingestion" below)
src/app/api/sync/[source]/route.ts      Scheduling entry point, `x-sync-token`-protected
src/proxy.ts                             HTTP Basic Auth gate for /admin + /api/admin/*
.github/workflows/sync-hangaren.yml      Actual cron trigger — see "Scheduling" below
```

### Hangaren ingestion (the one real, live source)

`src/lib/adapters/hangarenAdapter.ts` fetches `https://www.hangaren.dk/events` for real — not a
fixture — and parses the server-rendered HTML. It was chosen over Culture Box, Gravity and Den
Anden Side after checking all four for robots.txt permission, structured data, reliability and
maintenance burden (see the `integrationNote` on each in `src/lib/data/sources.ts`): Hangaren's
`/events` page lists every upcoming event on one request with semantic `<time datetime>` tags and
a Google Calendar link carrying exact UTC start/end instants, and its robots.txt disallows only
the `?format=json`/`?format=ical` shortcuts (named crawlers included), never the plain page.

No explicit genre field exists on the source, so genre classification falls back to a keyword
match — but the evidence hierarchy (`classification.ts`) already distinguishes a keyword match
against the *source's own description text about this specific event* ("official-description",
high confidence) from a generic title-only guess ("deterministic-mapping", medium). Hangaren's
bios routinely state the genre outright ("Hard Bounce, Schranz and Techno are genres that define
the sound of Kander"), so the adapter runs the keyword match against the full bio and credits it
at the correct (high) tier instead of the generic fallback — this isn't a weaker gate, it's
crediting real evidence the rules already call for. On a real live fetch this resolves 10/19
events to high confidence (auto-published) and leaves 9/19 in review, all for the same single
reason: the bio genuinely never states a genre, not a missing date/venue/title/URL. See "Manual
review workload" below for what that means week to week. Updates to already-known events
(date/time/lineup changes) apply automatically and respect manual overrides regardless. Run
`npm run db:verify-sync` for a live, repeatable proof of the whole flow.

### Manual review workload

On a real live fetch (19 upcoming events currently on the page, spanning roughly 13 weeks —
~1.5 events/week): 10 auto-publish, 9 need one review-queue action each (confirm genre, click
publish) — but that 9 is a **one-time backlog from the first sync ever**, not a per-week number.
Once caught up, a normal week only surfaces *new* candidates never seen before (~1.5/week at
Hangaren's posting cadence), of which historically about half clear the high-confidence bar
automatically; the rest are a single confirm-and-publish click each. Changes to events already
tracked (a lineup addition, a time slip) apply with zero admin action, protected fields survive
untouched. Estimated steady-state workload: **well under one manual action per week** for this
source — consistent with the brief's "a few minutes of exception handling," not "no review ever."

### Nightlife date logic (`datetime.ts`)

Club nights routinely run past midnight, so a plain calendar day breaks "Tonight", weekend
filters and archival timing. Every instant maps to a **nightlife day**: its calendar date, except
anything before 06:00 local still belongs to the previous night. `isTonight`, `isThisWeekend`,
`isNextWeekend`, month grouping, and archival (`isPastEvent`) all key off this, not the raw
calendar date. `now` is read from the visitor's own browser clock (`EventExplorer` mounts before
computing it) rather than baked in at build/request time, so correctness doesn't depend on cache
freshness. See `src/lib/datetime.test.ts` for the edge cases this covers (midnight/month/year
rollovers, weekend boundaries, overnight archival).

### Source roles and integration status (`src/lib/data/sources.ts`)

Every external reference is classified independently by role (discovery / ingestion /
verification / link) — the strongest discovery source isn't automatically the strongest
ingestion source. All four first-party venue/promoter pages (Culture Box, Hangaren, Den Anden
Side, Gravity) are marked `autoPublish: true` in the data model, but **only Hangaren currently has
a real, working adapter wired to the scheduler** (`src/lib/adapters/hangarenAdapter.ts` /
`POST /api/sync/hangaren`) — the other three are evaluated (structured-data availability, robots.txt
permission, current reliability) in their `integrationNote` but intentionally not yet implemented;
Gravity's `/events/` page 404s and its sitemap is over a year stale, and Den Anden Side's own site
carries no event content at all (it defers entirely to Resident Advisor). Resident Advisor,
AllEvents, Billetto, Eventbrite and the Facebook groups are discovery/verification/link references
only —
**automated ingestion from them is deliberately not implemented** until a permitted access method
(API, confirmed ToS allowance) is confirmed and documented on that source's `integrationNote`. Do
not add scraping for them without doing that first. `/about` renders this table for anyone
non-technical.

### Quality gate & dedup

`runIngestionPipeline()` (`adapters/pipeline.ts`) is what a real adapter's output would flow
through: required-field validation, venue/artist normalization, genre classification (evidence
hierarchy, never inferred from title alone as primary evidence), fuzzy duplicate detection against
existing events, and a confidence-based publish decision (auto-publish / review queue / hold — never
auto-publish below high confidence). The `/admin` page's "Add event from URL" tool runs a real,
best-effort Open Graph extraction through this same pipeline so the review UI reflects actual
pipeline output, not a mockup.

### Images

Per spec, images are optional and never required for the site to look finished — no seed event,
venue or festival currently sets one. `EventRecord.imageUrl` / `FestivalRecord.imageUrl` exist in
the data model and are already wired into Open Graph tags and JSON-LD when present; rendering an
`<img>` on the event/venue/festival detail pages once real images exist is a small, isolated
follow-up (would also need `images.remotePatterns` in `next.config.ts` for external hosts).

## Scheduling

`.github/workflows/sync-hangaren.yml` calls `POST /api/sync/hangaren` on a schedule — the source
refreshes automatically once deployed and configured, no manual trigger required.

- **Frequency**: every 6 hours (`cron: "0 */6 * * *"`), matching `src-hangaren`'s
  `syncFrequency` in `src/lib/data/sources.ts`. Also runnable on demand via the workflow's
  `workflow_dispatch` trigger (e.g. to retry after fixing something).
- **Retry behavior**: three layers, deliberately not aggressive at any one of them. (1) The
  workflow's `curl` retries the HTTP call itself up to 3 times (15s apart) for transient network
  issues reaching the deployment. (2) The adapter (`hangarenAdapter.ts`) retries the fetch against
  hangaren.dk once after a 2s delay — one blip shouldn't flag a healthy source as failed. (3)
  Beyond that, a persistently failing source is left for the next scheduled run 6h later (or a
  manual `workflow_dispatch`) rather than retried in a tight loop.
- **Failure logging**: every sync outcome is written to `sources.lastError`/`lastSuccessfulSync`
  in Postgres (visible on `/admin`) regardless of how it was triggered. The API route also returns
  a non-2xx status for `failed` and `zero_events` outcomes specifically (never for a normal
  `ok` or a benign `skipped_concurrent`), so the calling workflow run itself goes red in GitHub
  Actions' own history/notifications — that's the externally-visible failure log, not just a
  console line inside the process.
- **Secrets**: `SYNC_TRIGGER_TOKEN` must be set twice — as a GitHub Actions repository *secret*
  (so the workflow can send it) and as an environment variable on the actual deployment (so the
  route can check it); the workflow also needs a repository *variable* `SYNC_BASE_URL` pointing at
  the deployed app. Both are one-time setup after deploying — see the comment at the top of the
  workflow file. `ADMIN_USERNAME`/`ADMIN_PASSWORD` (below) are separate and only gate `/admin`.
- **Concurrent runs**: two layers. The workflow's own `concurrency:` group serializes overlapping
  *GitHub Actions* runs of this workflow. The real guarantee is inside the app: `runSourceSync`
  (`src/db/sync.ts`) takes a Postgres advisory lock (`pg_try_advisory_lock`, cluster-wide, not just
  per-process) for the duration of the sync and skips outright (`outcome: "skipped_concurrent"`,
  HTTP 200 — not an error) if another sync for the same source is already running, however it was
  triggered (scheduled, manual, or a retried request landing twice).

## Admin access

`/admin` (the review UI) and every `/api/admin/*` route (publish/edit/hide events, resolve the
discovery queue) are gated behind HTTP Basic Auth in `src/proxy.ts`, checked against
`ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars using a timing-safe comparison. If either is unset,
access is denied outright (fails closed, never silently open). This is deliberately not a user-
management system — a single shared credential pair is the simplest production-appropriate
stopgap for a small internal tool, per the brief. `/api/sync/[source]` is unaffected — it keeps
its own separate `x-sync-token` check so the scheduler can call it without a Basic Auth prompt.
Public pages are untouched.

Shows source health, the discovery review queue, and the "Add event from URL" tool described
above.

## Testing

`npm run test` runs the vitest suite: chronological sorting, Tonight/weekend filters and their
midnight-crossing edge cases, venue alias resolution, artist normalization, duplicate detection
tiers, genre evidence confidence, canonical source priority, the quality gate, calendar export
(including DST-safe UTC conversion and overnight events), manual-override field protection, the
Hangaren HTML parser against a real recorded response, and sync-time merge-decision logic
(`src/lib/sync.test.ts`).

`npm run db:verify-sync` is a separate, DB-backed proof (not part of `npm test`, since it needs a
live Postgres and makes one real network call to hangaren.dk): it live-fetches the real source,
then runs the real `runSourceSync`/database code path through new-event, duplicate,
changed-date/time, changed-lineup, provenance-persisted-at-publish, manual-override-survives-sync,
source-failure, zero-events-anomaly, and concurrent-runs scenarios, asserting against the actual
database each time. Idempotent — cleans up its own prior run before each execution.
