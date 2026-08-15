# Nattefrekvens — Copenhagen electronic music events

A fast, curated, largely self-maintaining index of electronic music events in Copenhagen &
Frederiksberg. See the product brief this was built against for full requirements; this file
covers what's implemented, how it's organised, and what's intentionally left for later phases.

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS v4. No database yet — see "Current phase" below.

```bash
npm install
npm run dev      # http://localhost:3000
npm run test     # vitest — datetime, dedup, normalization, classification, ICS export
npm run build    # production build (all routes are statically generated except /api/*)
npm run lint
```

## Current phase

This implements **Phase 1 (visual/product proof) and the Phase 2 data foundation** from the
build order in the brief: the full UX against realistic sample data, plus the taxonomy, venue
registry, dedup/normalization logic, source registry, and adapter architecture that a real
ingestion pipeline plugs into. **Phase 3 (live ingestion) is not wired up** — `src/lib/data/*.ts`
stands in for the canonical database. Swapping it for real persistence (Postgres/Supabase) means
implementing the same query shapes in `src/lib/queries.ts` against a database instead of static
arrays; nothing in the UI layer assumes static data.

## Preparing the production database

`.github/workflows/prepare-production-db.yml` is a manual-only (`workflow_dispatch`, no schedule,
no trigger on push/PR) GitHub Actions workflow for running database migrations and a
production-safe reference-data seed against a real deployment. It requires a `DATABASE_URL`
repository secret, fails immediately if that secret is missing, never prints its value, and makes
no deployment or infrastructure changes.

**Note:** the workflow's seed step runs `npm run db:seed:production`, which is not yet defined on
this branch — that command and its underlying script land with a separate, larger change. Until
then, running this workflow will succeed through `npm run db:migrate` and then fail cleanly at the
seed step with an "unknown script" error; it will not write to `venues`, `sources`, `events`, or
`discovery_queue`. This is expected and safe — the workflow is being made available ahead of that
change, not run against it yet.

1. **Add the `DATABASE_URL` repository secret.** In the repo on GitHub: Settings → Secrets and
   variables → Actions → Secrets tab → "New repository secret". Name: `DATABASE_URL`. Value: the
   production Postgres connection string (e.g. your Supabase connection string). Save.
2. **Run the workflow manually.** Actions tab → "Prepare Production Database" in the left sidebar
   → "Run workflow" → in the `confirm` box type exactly `PREPARE-PRODUCTION-DB` → "Run workflow".
   It will fail immediately (before touching the database) if `DATABASE_URL` isn't set or the
   confirmation text doesn't match exactly.
3. **Verify success.** Open the completed run: the "Apply database migrations" step should show a
   green check. Until `db:seed:production` exists on this branch, the seed step will fail with a
   clear "unknown script" error — that failure means nothing was written beyond the migration, not
   that something went wrong.

## Scheduling: Hangaren sync

`.github/workflows/sync-hangaren.yml` calls a deployed app's `POST /api/sync/hangaren` endpoint
every 6 hours (`workflow_dispatch` also available for a manual re-trigger) to run a Hangaren
ingestion sync. It only calls the deployed app over HTTP, so it doesn't require any ingestion
application code to be present in this branch — but it does need two one-time GitHub setup steps
before it can do anything:

1. **Repository variable `SYNC_BASE_URL`.** Settings → Secrets and variables → Actions →
   Variables tab → "New repository variable". Value: the deployed app's base URL (e.g.
   `https://your-deployment.example.com`), no trailing slash.
2. **Repository secret `SYNC_TRIGGER_TOKEN`.** Settings → Secrets and variables → Actions →
   Secrets tab → "New repository secret". Value must match the `SYNC_TRIGGER_TOKEN` environment
   variable configured on the deployment itself (see `.env.example`).

Until both are set, the workflow fails fast with a clear error instead of silently doing nothing.

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
  queries.ts                    Data-access layer — the only place that reads src/lib/data/*
  sourceHealth.ts                Source registry health classification
  data/                            Seed data standing in for the database (Phase 1)
  adapters/
    types.ts                        RawCandidateEvent — the shape every adapter must produce
    firstPartyAdapter.ts              Reference adapter for first-party venue/promoter feeds
    deterministicGenreMapping.ts       Keyword fallback — evidence tier 5, never tier 1
    pipeline.ts                         EXTRACTION → VALIDATION → NORMALIZATION → DEDUP →
                                         CLASSIFICATION → CONFIDENCE → PUBLISH/REVIEW, as pure
                                         functions. Adapters only ever produce RawCandidateEvent;
                                         everything downstream is adapter-agnostic.
```

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
ingestion source. Only first-party venue/promoter pages (Culture Box, Hangaren, Den Anden Side,
Gravity) have `adapter` set and `autoPublish: true`. Resident Advisor, AllEvents, Billetto,
Eventbrite and the Facebook groups are discovery/verification/link references only —
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

## `/admin`

Internal-only (not linked from the public nav, `robots: noindex`, no auth in this preview build —
add real auth before deploying this route). Shows source health, the discovery review queue, and
the "Add event from URL" tool described above.

## Testing

`npm run test` runs the vitest suite: chronological sorting, Tonight/weekend filters and their
midnight-crossing edge cases, venue alias resolution, artist normalization, duplicate detection
tiers, genre evidence confidence, canonical source priority, the quality gate, and calendar export
(including DST-safe UTC conversion and overnight events).
