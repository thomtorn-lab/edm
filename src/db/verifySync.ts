import { eq } from "drizzle-orm";
import { db } from "./client";
import { discoveryQueue, eventChangeLog, events, sourceEventLinks, sources } from "./schema";
import { runSourceSync } from "./sync";
import { applyAdminEventEdit, publishDiscoveryItem } from "./writes";
import { createHangarenAdapter, HANGAREN_SOURCE_ID } from "@/lib/adapters/hangarenAdapter";
import type { RawCandidateEvent } from "@/lib/adapters/types";
import type { SourceAdapter } from "@/lib/adapters/types";
import { getEventBySlugWithVenue, getPublishedEventsWithVenue } from "@/lib/queries";

/**
 * End-to-end proof for the Hangaren ingestion adapter (task 6). Runs the
 * REAL production code path (src/db/sync.ts::runSourceSync -> the same
 * pipeline/writes/queries modules the API route and admin tools use)
 * against the REAL Postgres database.
 *
 * Step 1 is a genuinely live network fetch of https://www.hangaren.dk/events
 * through the real adapter (src/lib/adapters/hangarenAdapter.ts) — the same
 * one src/app/api/sync/[source]/route.ts calls on a schedule.
 *
 * Steps 2+ exercise specific scenarios (a date change, a lineup change, a
 * manual override surviving a later sync, a source outage, a zero-events
 * anomaly) that cannot be scheduled on demand from the live source. Those
 * steps inject controlled RawCandidateEvent inputs directly into the same
 * real runSourceSync()/database code path — standard integration-test
 * practice, clearly distinguished here from step 1's live fetch. Nothing
 * about the pipeline, the database writes, or the query layer is mocked.
 */

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function stubAdapter(candidates: RawCandidateEvent[]): SourceAdapter {
  return { sourceId: HANGAREN_SOURCE_ID, fetchCandidates: async () => candidates };
}
function failingAdapter(message: string): SourceAdapter {
  return {
    sourceId: HANGAREN_SOURCE_ID,
    fetchCandidates: async () => {
      throw new Error(message);
    },
  };
}

const KANDER_URL = "https://www.hangaren.dk/events/20268/0815/kander";
const DARIA_URL = "https://www.hangaren.dk/events/20268/0821/dariak";

function kanderCandidate(overrides: Partial<RawCandidateEvent> = {}): RawCandidateEvent {
  return {
    sourceId: HANGAREN_SOURCE_ID,
    sourceUrl: "https://www.hangaren.dk/events",
    title: "Kander, kardinal bertram, uber knast",
    description: "Hard Bounce, Schranz and Techno are genres that define the sound of Kander.",
    artists: ["Kander", "Kardinal Bertram", "Uber Knast"],
    startDatetime: "2026-08-15T18:00:00.000Z",
    endDatetime: "2026-08-16T04:00:00.000Z",
    venueName: "Hangaren",
    officialEventUrl: KANDER_URL,
    ticketUrl: "https://ra.co/events/2461529",
    facebookUrl: null,
    residentAdvisorUrl: "https://ra.co/events/2461529",
    imageUrl: "https://images.squarespace-cdn.com/kander.png",
    priceFrom: null,
    genreHint: null,
    genreConfidenceHint: null,
    soldOutHint: null,
    cancelledHint: null,
    ...overrides,
  };
}

function dariaCandidate(): RawCandidateEvent {
  return {
    sourceId: HANGAREN_SOURCE_ID,
    sourceUrl: "https://www.hangaren.dk/events",
    title: "Daria Kolosova, Funeral Future, Pai-lin",
    description: "Daria is one of the fastest-rising names in the techno scene.",
    artists: ["Daria Kolosova", "Funeral Future", "Pai-lin"],
    startDatetime: "2026-08-21T18:00:00.000Z",
    endDatetime: "2026-08-22T04:00:00.000Z",
    venueName: "Hangaren",
    officialEventUrl: DARIA_URL,
    ticketUrl: "https://ra.co/events/2461512",
    facebookUrl: null,
    residentAdvisorUrl: "https://ra.co/events/2461512",
    imageUrl: null,
    priceFrom: null,
    genreHint: null,
    genreConfidenceHint: null,
  };
}

async function cleanup() {
  const urls = [KANDER_URL, DARIA_URL];
  for (const url of urls) {
    const links = await db.select().from(sourceEventLinks).where(eq(sourceEventLinks.sourceUrl, url));
    const byUrl = await db.select().from(events).where(eq(events.officialEventUrl, url));
    const eventIds = new Set([...links.map((l) => l.eventId), ...byUrl.map((e) => e.id)]);
    for (const eventId of eventIds) {
      await db.delete(eventChangeLog).where(eq(eventChangeLog.eventId, eventId));
      await db.delete(sourceEventLinks).where(eq(sourceEventLinks.eventId, eventId));
      await db.delete(events).where(eq(events.id, eventId));
    }
    await db.delete(sourceEventLinks).where(eq(sourceEventLinks.sourceUrl, url));
    await db.delete(discoveryQueue).where(eq(discoveryQueue.sourceUrl, url));
  }
  await db.update(sources).set({ lastError: null }).where(eq(sources.id, HANGAREN_SOURCE_ID));
}

async function main() {
  console.log("=== Hangaren ingestion — end-to-end proof ===\n");
  await cleanup();

  // ---- Step 1: real live fetch + parse against the real source ----
  console.log("Step 1: live fetch of https://www.hangaren.dk/events through the real adapter");
  const liveAdapter = createHangarenAdapter();
  const live = await liveAdapter.fetchCandidates();
  check("live fetch returns events", live.length > 0, `got ${live.length}`);
  check("live events carry real ra.co/billetto ticket links", live.some((e) => e.ticketUrl?.includes("ra.co") || e.ticketUrl?.includes("billetto")));
  console.log(`  (${live.length} real upcoming events currently on the page)\n`);

  // ---- Step 2: new event -> lands in discovery queue (medium genre confidence, honest gate) ----
  console.log("Step 2: NEW EVENT — first sighting of Kander (overnight) and Daria Kolosova");
  const s2 = await runSourceSync(HANGAREN_SOURCE_ID, "Hangaren", stubAdapter([kanderCandidate(), dariaCandidate()]));
  check("sync outcome ok", s2.outcome === "ok");
  check("both land in review (no explicit genre metadata -> medium confidence, never auto-published below high)", s2.queuedForReview === 2, JSON.stringify(s2));
  const queueRows = await db.select().from(discoveryQueue).where(eq(discoveryQueue.sourceUrl, KANDER_URL));
  check("Kander queued with correct probable start (overnight, spans midnight)", queueRows[0]?.probableStart?.toISOString() === "2026-08-15T18:00:00.000Z");

  // ---- Step 3: admin publishes Kander -> provenance persists immediately, event on the public homepage/detail page ----
  console.log("\nStep 3: admin publish (real write path) -> provenance + public homepage/detail page");
  const [kanderQueueItem] = await db.select().from(discoveryQueue).where(eq(discoveryQueue.sourceUrl, KANDER_URL));
  check("discovery item carries the registered source id (not null)", kanderQueueItem.sourceId === HANGAREN_SOURCE_ID);
  const kanderEventId = await publishDiscoveryItem(kanderQueueItem.id, "v-hangaren");

  // Provenance must exist NOW, immediately after publish — not reconstructed later by a
  // fuzzy-match sync. This is the fix for task item 3 (publishDiscoveryItem previously set
  // canonicalSourceId: null unconditionally, so no source link was ever recorded at publish time).
  const linksRightAfterPublish = await db.select().from(sourceEventLinks).where(eq(sourceEventLinks.eventId, kanderEventId));
  check("source link recorded immediately at publish (before any sync runs)", linksRightAfterPublish.some((l) => l.sourceId === HANGAREN_SOURCE_ID && l.sourceUrl === KANDER_URL));
  const [publishedRow] = await db.select().from(events).where(eq(events.id, kanderEventId));
  check("event's canonicalSourceId set at publish", publishedRow.canonicalSourceId === HANGAREN_SOURCE_ID);

  const published = await getPublishedEventsWithVenue();
  const onHomepage = published.find((e) => e.id === kanderEventId);
  check("published event appears in the exact query the public homepage uses", Boolean(onHomepage));
  check("detail-page query resolves it by slug too", Boolean(onHomepage && (await getEventBySlugWithVenue(onHomepage.slug))));

  // The discovery queue only stores a probable *start* (spec's Phase 2 schema) — publishing
  // from it doesn't carry an end time yet. A real source sync fills that in, same as any
  // other field the initial discovery pass couldn't determine — and because provenance
  // already exists, this sync must match via the direct link, not a fuzzy duplicate guess.
  const linkCountBeforeSync = linksRightAfterPublish.length;
  await runSourceSync(HANGAREN_SOURCE_ID, "Hangaren", stubAdapter([kanderCandidate()]));
  const linksAfterSync = await db.select().from(sourceEventLinks).where(eq(sourceEventLinks.eventId, kanderEventId));
  check("provenance survives the subsequent sync unchanged (matched via the existing link, not re-created)", linksAfterSync.length === linkCountBeforeSync);
  const [withEndTime] = await db.select().from(events).where(eq(events.id, kanderEventId));
  check(
    "overnight flag survives: end date is the day after start",
    withEndTime.endDatetime !== null && withEndTime.endDatetime.toISOString().slice(0, 10) !== withEndTime.startDatetime.toISOString().slice(0, 10),
  );

  // ---- Step 4: subsequent source update — changed date/time + changed lineup ----
  console.log("\nStep 4: SUBSEQUENT SOURCE UPDATE — Kander's time slips 2h, lineup grows");
  const s4 = await runSourceSync(
    HANGAREN_SOURCE_ID,
    "Hangaren",
    stubAdapter([kanderCandidate({ startDatetime: "2026-08-15T20:00:00.000Z", artists: ["Kander", "Kardinal Bertram", "Uber Knast", "Guest DJ"] })]),
  );
  check("sync applies as an update, not a duplicate create", s4.updated === 1 && s4.created === 0, JSON.stringify(s4));
  const [afterUpdate] = await db.select().from(events).where(eq(events.id, kanderEventId));
  check("startDatetime actually changed", afterUpdate.startDatetime.toISOString() === "2026-08-15T20:00:00.000Z");
  check("timeChanged flag set (same night, later door time)", afterUpdate.timeChanged === true);
  check("dateChanged NOT set (still the same calendar night)", afterUpdate.dateChanged === false);
  check("lineup updated with the added guest", afterUpdate.artists.includes("Guest DJ"));

  // ---- Step 5: duplicate — an unchanged re-sync must not create a second row or spam the changelog ----
  console.log("\nStep 5: DUPLICATE — re-syncing the identical (already-applied) candidate");
  const s5 = await runSourceSync(
    HANGAREN_SOURCE_ID,
    "Hangaren",
    stubAdapter([kanderCandidate({ startDatetime: "2026-08-15T20:00:00.000Z", artists: ["Kander", "Kardinal Bertram", "Uber Knast", "Guest DJ"] })]),
  );
  check("no new event created for a re-seen event", s5.created === 0);
  const eventCountForKanderUrl = await db.select().from(events).where(eq(events.officialEventUrl, KANDER_URL));
  check("still exactly one row for this event", eventCountForKanderUrl.length === 1);

  // ---- Step 6: manual override survives a later sync ----
  console.log("\nStep 6: MANUAL OVERRIDE — admin hand-corrects genre, then a later sync tries to change it back");
  await applyAdminEventEdit(kanderEventId, { primaryGenre: "hard-techno" });
  const s6 = await runSourceSync(
    HANGAREN_SOURCE_ID,
    "Hangaren",
    stubAdapter([kanderCandidate({ title: "Kander B2B Special", startDatetime: "2026-08-15T20:00:00.000Z" })]),
  );
  check("sync still applies the unprotected title change", s6.updated === 1);
  const [afterOverrideSync] = await db.select().from(events).where(eq(events.id, kanderEventId));
  check("title changed", afterOverrideSync.title === "Kander B2B Special");
  check("admin-corrected genre was NOT reverted by the sync", afterOverrideSync.primaryGenre === "hard-techno");

  // ---- Step 7: source failure — must never look like a cancellation ----
  console.log("\nStep 7: SOURCE FAILURE — the source times out / errors");
  const beforeFailure = (await db.select().from(events).where(eq(events.id, kanderEventId)))[0];
  const s7 = await runSourceSync(HANGAREN_SOURCE_ID, "Hangaren", failingAdapter("fetch failed: getaddrinfo ENOTFOUND"));
  check("outcome is 'failed', not silently swallowed", s7.outcome === "failed");
  const [sourceRowAfterFailure] = await db.select().from(sources).where(eq(sources.id, HANGAREN_SOURCE_ID));
  check("lastError recorded distinctly", Boolean(sourceRowAfterFailure.lastError?.includes("ENOTFOUND")));
  const afterFailure = (await db.select().from(events).where(eq(events.id, kanderEventId)))[0];
  check("existing event completely untouched (not cancelled, not hidden)", !afterFailure.cancelled && afterFailure.published && afterFailure.updatedAt.getTime() === beforeFailure.updatedAt.getTime());

  // ---- Step 8: zero-event anomaly — must never be read as "no events this week" ----
  console.log("\nStep 8: ZERO-EVENT ANOMALY — a successful fetch that parses to 0 events");
  const s8 = await runSourceSync(HANGAREN_SOURCE_ID, "Hangaren", stubAdapter([]));
  check("outcome distinguishes zero-events from a fetch failure", s8.outcome === "zero_events");
  const [sourceRowAfterZero] = await db.select().from(sources).where(eq(sources.id, HANGAREN_SOURCE_ID));
  check("flagged for review, not treated as 'venue has nothing on'", Boolean(sourceRowAfterZero.lastError?.toLowerCase().includes("anomaly") || sourceRowAfterZero.lastError?.includes("never")));
  const afterZero = (await db.select().from(events).where(eq(events.id, kanderEventId)))[0];
  check("no existing event was cancelled/hidden because of it", !afterZero.cancelled && afterZero.published);

  // ---- Step 9: concurrent runs — the second must be skipped, not race the first ----
  console.log("\nStep 9: CONCURRENT RUNS — two syncs for the same source fired at once");
  const slowAdapter: SourceAdapter = {
    sourceId: HANGAREN_SOURCE_ID,
    fetchCandidates: async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return [kanderCandidate()];
    },
  };
  const [c1, c2] = await Promise.all([
    runSourceSync(HANGAREN_SOURCE_ID, "Hangaren", slowAdapter),
    runSourceSync(HANGAREN_SOURCE_ID, "Hangaren", slowAdapter),
  ]);
  const outcomes = [c1.outcome, c2.outcome].sort();
  check("exactly one run proceeds and one is skipped (advisory lock, cluster-wide not per-process)", outcomes[0] === "ok" && outcomes[1] === "skipped_concurrent", JSON.stringify(outcomes));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
