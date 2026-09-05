# Source Onboarding

How a new event source (a venue, promoter, ticketing platform, or aggregator) gets added to
Electronic CPH, end to end, with minimum human involvement. This is the **source onboarding
factory**: a durable set of scripts, workflows and conventions — not a one-off process re-invented
per source. Hangaren, Culture Box, Poolen and Billetto are the reference implementations; read
their adapters (`src/lib/adapters/*Adapter.ts`) and registry entries (`src/lib/data/sources.ts`)
before starting a new one.

## The standard flow

```
DISCOVER → DIAGNOSE → IMPLEMENT → TEST → VALIDATE → FIX/RETRY → MERGE GATE → PRODUCTION VERIFY
```

**DISCOVER** — Identify the source's real events page/API. Check `src/lib/data/sources.ts` first:
several candidates (e.g. Klub Werkstatt, Pumpehuset, Bolsjefabrikken) already have a research-only
entry with `adapter: null` and an `integrationNote` describing what's known so far — start from
that note rather than re-researching from scratch.

**DIAGNOSE** — Confirm, don't assume:
- Fetch `robots.txt` directly and check whether the events page (or a JSON/ICS export) is actually
  permitted for automated fetching. Never scrape something robots.txt disallows (see Hangaren's own
  adapter for the canonical example of finding a permitted alternative).
- Confirm the page is server-rendered HTML (no headless browser needed) or a real documented JSON
  API. If it needs JS execution to render content, that's a real blocker — flag it, don't add a
  headless-browser dependency without checking in first (this repo has none today).
- Use `inspect-source.yml` (mode `reachability`) or `npm run db:inspect-source -- --mode=reachability
  --endpoint=<url>` to confirm the page is actually reachable from a real network (agent sandboxes
  in this project routinely cannot reach external hosts at all — GitHub-hosted runners can, see
  `verify-db-readonly.yml`'s header comment for the exact reasoning).
- If the source requires an API credential (API key, OAuth), this is a genuine STOP condition (see
  below) — request it from the user, do not self-provision or guess at one.

**IMPLEMENT** — Run `node scripts/scaffold-source.mjs --id=<slug> --name="<Display Name>"
--base-url=<https://...> --kind=html` to generate the adapter/test/sync-workflow skeleton (see
"Adapter scaffold" below). Capture a real, unmodified fixture of the actual page before writing any
parsing logic — never write a parser against imagined HTML. Follow the RawCandidateEvent contract
(`src/lib/adapters/types.ts`) exactly; everything downstream (validation, dedup, classification,
publish/review gate) is already generic and adapter-agnostic — do not duplicate any of that logic
inside the new adapter.

**TEST** — Unit tests against the real captured fixture, same granularity as
`hangarenAdapter.test.ts`: date/time extraction (prefer an unambiguous UTC-instant source over
AM/PM text parsing where available), lineup extraction, genre-hint evidence tier, ticket/RA URL
fallback, malformed-record resilience (a single bad block must never throw). Run `npm run test`,
`npm run lint`, `npm run build` locally before proposing anything.

**VALIDATE** — Dispatch `validate-source.yml` against your branch. With `run_live_sync: false` it
only runs the static checks above; with `run_live_sync: true` (and a Preview deployment URL) it
also runs a real sync against the shared database, twice, and proves idempotency, source health,
lock cleanup, and zero regression on every other adapter-backed source — all from one permanent,
reusable workflow. See "Standard merge-readiness report" below for what a clean run looks like.

**FIX/RETRY** — A failing test, a lint error, a sync returning `partial_failure`, a source
reporting `zero_events` on the first run, a flaky network blip — all of these are routine and
diagnosable from the workflow output. Fix and re-run `validate-source.yml`. This loop is entirely
autonomous; do not stop to ask about a routine failure (see "When to STOP" below for what actually
warrants a pause).

**MERGE GATE** — Once `validate-source.yml` is clean, present the merge-readiness report (below)
and stop for the user's Production-merge approval. This is a hard stop regardless of how clean the
validation was — see "When to STOP".

**PRODUCTION VERIFY** — After the user merges: confirm the source's first scheduled/manual sync in
Production via `inspect-source.yml` (`health`, `discovery-queue`, `snapshot` modes). Nothing here
should require a new workflow file — `inspect-source.yml` already covers it.

## When Claude MUST STOP

Everything above runs autonomously. Stop and ask the user **only** for:

**A. Credentials or external permissions that genuinely require user action.** An API key, an
OAuth grant, a publisher relationship, anything the project doesn't already hold. Never
self-provision, guess, or fabricate a credential. (Billetto's `BILLETTO_ACCESS_KEY_ID` /
`BILLETTO_ACCESS_KEY_SECRET` is the existing precedent — diagnosis and adapter-writing proceeded
fully autonomously up to the point a real key pair was needed, then stopped and asked.)

**B. A material product or quality-policy choice that can't be safely inferred.** Examples: should
a source with no explicit genre metadata ever auto-publish (the answer today is no — the quality
gate never auto-publishes below high genre confidence, and that default should hold for a new
source too unless the user says otherwise); should a borderline/ambiguous category (like Billetto's
`hardcore` subcategory, which turned out to mean hardcore *punk*, not hardcore *techno*) be trusted
as electronic-genre evidence; should a venue that's only occasionally electronic (e.g. Pumpehuset)
be onboarded at all given the coverage-per-maintenance-effort tradeoff already noted in its
registry entry. When in doubt, default conservative (`autoPublish: false`, review-queue-first,
`trustLevel: medium`) and flag the judgment call rather than silently picking a side.

**C. Production merge approval.** Never merge a source-onboarding branch to the production branch
without the user's explicit go-ahead, however clean `validate-source.yml` came back.

**Routine failures are never a STOP condition.** A failing test, a lint error, a transient network
timeout, a `zero_events` or `partial_failure` sync outcome, a page-structure change that breaks a
selector, a dedup edge case that needs a rule tweak — all of these are Claude's job to diagnose and
fix, exactly as the existing adapters' own `integrationNote` history shows (e.g. Billetto's
multi-pass credential/schema diagnosis in its own registry entry). Re-run `validate-source.yml`
after each fix; only escalate if the same class of failure survives several independent fix
attempts, and even then, present a fix attempt and open question — not a bare "it's broken."

## Permanent tooling this factory provides

- **`.github/workflows/inspect-source.yml`** — one permanent, parameterized, read-only diagnostic
  workflow. Modes: `inventory`, `health`, `discovery-queue`, `source-links`, `lock-status`,
  `dedup-simulate`, `reachability`, `snapshot`, `venues`, `venue-events`, `discovery-queue-venues`,
  `venue-blocks`, `event-integrity`, `link-role-audit`, `db-integrity`, `adapter-dry-run`.
  `adapter-dry-run` is the read-only pre-merge production-readiness check (VALIDATE step, live-data
  variant that never writes): it runs a real, already-implemented-but-not-yet-merged adapter's
  `fetchCandidates()` against the actual live source plus the shared pipeline against the real
  database's live venues/existing-events, and reports decision/dedup/venue-resolution breakdowns —
  without ever calling `createEvent`/`insertDiscoveryItem`. Use this (never a one-off script) when a
  source must be proven safe against current live data before it's registered/merged at all, i.e.
  before any Preview deployment can carry its adapter for `validate-source.yml`'s own
  `run_live_sync` phase to exercise. Replaces the old pattern of hand-writing a new
  one-off workflow (`verify-db-readonly.yml`, `verify-discogs-reachability.yml`,
  `monitor-source-health.yml`'s bespoke inline script) every time something needed inspecting.
  Wraps `src/db/inspectSource.ts`, which does the actual work and can also be run locally:
  `npm run db:inspect-source -- --mode=<mode> --source=<sourceId> [...]`.

- **`.github/workflows/validate-source.yml`** — one permanent, parameterized validation workflow.
  Takes a `source_id` and a branch/SHA `ref`; always runs lint/tests/typecheck+build; optionally
  (`run_live_sync: true`, gated behind a confirmation string) runs a real sync against a Preview
  deployment twice, snapshotting before/after and fingerprinting every other adapter-backed source
  for regressions. Replaces the old pattern of a fresh `verify-<source>-preview.yml` per source
  (`verify-culture-box-preview.yml`, `verify-poolen-preview.yml`, `verify-billetto-preview.yml` were
  >90% identical, hardcoded to one branch/URL, and discarded after use).

- **`scripts/scaffold-source.mjs`** — generates the adapter/test/sync-workflow skeleton for a new
  HTML-based source (`--kind=html`) from the same template `hangarenAdapter.ts` and
  `sync-hangaren.yml` already follow. For a credentialed API source, copy `billettoAdapter.ts`
  directly instead (auth scheme/pagination/response shape vary too much per source for one
  template to fit safely) — the scaffold explicitly says so if you pass `--kind=api`. For a plain
  first-party JSON feed, no new file is needed at all: use
  `createFirstPartyAdapter()` from `src/lib/adapters/firstPartyAdapter.ts` directly. The scaffold
  never edits an existing file — it prints the (small, ~3-line) remaining edits to
  `src/lib/data/sources.ts`, `src/app/api/sync/[source]/route.ts` and
  `src/db/checkSourceHealth.ts` as a checklist instead, because line-splicing an existing file by
  script is more fragile than making those edits directly.

## Standard merge-readiness report

Every source-onboarding branch presented for merge approval should report exactly this, in this
order — pulled directly from a `validate-source.yml` run and/or `inspect-source.yml` snapshots, not
hand-summarized:

1. **Branch / SHA** validated
2. **Source** (id, display name, adapter kind)
3. **Candidates found** (raw count from the adapter's `fetchCandidates()`)
4. **Qualifying events** (auto-published — high genre confidence, all required fields present)
5. **Rejected events** (held — missing required fields or no credible electronic-relevance
   evidence)
6. **Canonical events created** (count, first sync)
7. **Existing events matched** (count updated via `source_event_links`, not duplicated)
8. **Review cases** (count landed in `discovery_queue`, medium-confidence)
9. **Dedup results** (any candidate matched an existing event across a *different* source; false
   positives avoided — e.g. room-partition conflicts, conflicting headliners)
10. **Venue-resolution results** (any candidate venue name that failed to resolve against the
    registry — a real gap, not silently dropped)
11. **Idempotency** (second sync run: created should be 0, discovery_queue/events counts stable
    modulo legitimate classification refreshes)
12. **Source health** (`inspect-source.yml` `health` mode verdict: ok/degraded/stale)
13. **Regression checks** (every other adapter-backed source's fingerprint unchanged)
14. **Tests / lint / typecheck+build** (pass/fail)
15. **Remaining risks** (anything not fully verified — e.g. robots.txt permission inferred vs.
    directly confirmed, a credential's rate limit, a category/genre mapping edge case)
16. **READY TO MERGE** or **NOT READY** (with the specific blocker)

## Conventions every source must follow (already enforced by shared code, not re-implemented)

- Output only ever `RawCandidateEvent` (`src/lib/adapters/types.ts`) — never write directly to the
  database from an adapter.
- Genre evidence follows the hierarchy in `src/lib/classification.ts`
  (`GENRE_EVIDENCE_ORDER`): official metadata/description first, deterministic keyword mapping as
  fallback, never a title-only guess treated as high confidence.
- Dedup runs through `src/lib/dedup.ts` unchanged — do not hand-roll a source-specific duplicate
  check.
- Concurrency safety (`sync_locks`), source-health tracking, discovery-queue population, and the
  publish/review/hold gate are all handled by `src/db/sync.ts::runSourceSync` once the adapter is
  registered in `src/app/api/sync/[source]/route.ts` — nothing about them is source-specific.
- Default to conservative production settings on first merge: `autoPublish: false` or
  `trustLevel: medium` until a real sync has proven the source's genre-confidence and dedup
  behavior in practice; tighten later in a follow-up, not as a Day 1 assumption.
