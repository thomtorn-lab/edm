import { DISCOVERY_QUEUE } from "@/lib/data/discoveryQueue";
import { EVENTS } from "@/lib/data/events";
import { SOURCES } from "@/lib/data/sources";
import { VENUES } from "@/lib/data/venues";
import { normalizeVenueName } from "@/lib/normalize";

/**
 * Rules for the "Verify Database (Read-Only)" workflow (2026-10-25), kept
 * pure so they can be unit-tested; src/db/verifyDbReadonlyCli.ts gathers the
 * snapshot inside a READ ONLY transaction and prints the report.
 *
 * The workflow was created (2026-08) to confirm that an accidental
 * `npm run db:seed:dev` never reached the shared Production database. Its
 * first version also failed on every source/venue id missing from two lists
 * hardcoded at the time, so every source onboarded and every venue created
 * in admin since then raised CONTAMINATION DETECTED. Findings are now in
 * three classes:
 *
 *   - confirmed: seedDev's own fixture data — fails the run;
 *   - investigate: unexplained, but not proof of contamination (a source
 *     outside the code registry, a registry source with no row, a venue
 *     whose name is a place, not a venue) — reported as warnings;
 *   - info: normal activity (non-registry venues created in admin, recent
 *     sync/discovery activity) — reported only.
 *
 * Every fixture signal is derived from the same modules seedDev.ts inserts
 * (src/lib/data/*), so it can't drift from what a dev seed would write.
 */

export type FindingClass = "confirmed" | "investigate" | "info";

export interface Finding {
  class: FindingClass;
  check: string;
  detail: string;
}

export interface SourceRow {
  id: string;
  last_successful_sync: Date | null;
  last_attempted_sync: Date | null;
  last_error: string | null;
  events_found: number | null;
  events_updated: number | null;
}

export interface VenueRow {
  id: string;
  name: string;
  /** Events whose venue_id is this venue. */
  event_count: number;
}

export interface RecencyRow {
  table: string;
  column: string;
  /** Every row touched in the window. */
  total: number;
  /** The newest rows, at most RECENCY_DISPLAY_LIMIT. */
  shown: { id: string; at: Date }[];
}

export interface Snapshot {
  /** Events whose id is one of seedDev's fixture ids. */
  fixtureIdEvents: { id: string; title: string }[];
  /** Events (any id) with a fixture's exact title, start time and venue. */
  fixtureLookalikeEvents: { id: string; title: string }[];
  fixtureIdDiscovery: { id: string; probable_title: string | null }[];
  /** Discovery rows (any id) with a fixture's exact probable title and source name. */
  fixtureLookalikeDiscovery: { id: string; probable_title: string | null }[];
  sources: SourceRow[];
  venues: VenueRow[];
  recency: RecencyRow[];
  totals: { events: number; discovery_queue: number; venues: number; sources: number };
}

export const RECENCY_DISPLAY_LIMIT = 20;
export const RECENCY_DAYS = 3;

export const FIXTURE_EVENT_IDS: readonly string[] = EVENTS.map((e) => e.id);
export const FIXTURE_DISCOVERY_IDS: readonly string[] = DISCOVERY_QUEUE.map((d) => d.id);

/** (title, start, venue) of every fixture event — a seeded copy under another id still matches all three. */
export const FIXTURE_EVENT_SIGNATURES = EVENTS.map((e) => ({ title: e.title, start: new Date(e.startDatetime), venueId: e.venueId }));
export const FIXTURE_DISCOVERY_SIGNATURES = DISCOVERY_QUEUE.map((d) => ({ title: d.probableTitle, sourceName: d.sourceName }));

export const REGISTRY_SOURCE_IDS: ReadonlySet<string> = new Set(SOURCES.map((s) => s.id));
export const REGISTRY_VENUE_IDS: ReadonlySet<string> = new Set(VENUES.map((v) => v.id));

interface FixtureHealth {
  last_successful_sync?: string;
  last_attempted_sync?: string;
  last_error?: string;
  events_found?: number;
  events_updated?: number;
}

/**
 * Staged sync-health values only seedDev writes (bootstrapProduction never
 * writes health fields; real syncs write real timestamps): today's fixtures
 * from src/lib/data/sources.ts, plus the values the fixtures carried in
 * 2026-08, which the first version of this workflow checked — a seed run
 * from that time would have written those.
 */
export const FIXTURE_SOURCE_HEALTH: { id: string; health: FixtureHealth }[] = [
  ...SOURCES.filter((s) => s.lastSuccessfulSync || s.lastAttemptedSync || s.lastError || s.eventsFound || s.eventsUpdated).map((s) => ({
    id: s.id,
    health: {
      ...(s.lastSuccessfulSync ? { last_successful_sync: new Date(s.lastSuccessfulSync).toISOString() } : {}),
      ...(s.lastAttemptedSync ? { last_attempted_sync: new Date(s.lastAttemptedSync).toISOString() } : {}),
      ...(s.lastError ? { last_error: s.lastError } : {}),
      events_found: s.eventsFound,
      events_updated: s.eventsUpdated,
    },
  })),
  { id: "src-culture-box", health: { last_successful_sync: "2026-08-13T05:00:00.000Z", events_found: 14, events_updated: 2 } },
  { id: "src-hangaren", health: { last_successful_sync: "2026-08-13T04:30:00.000Z", events_found: 9, events_updated: 1 } },
  {
    id: "src-gravity",
    health: { events_found: 0, events_updated: 0, last_error: "0 events parsed from the last 3 attempts — likely page structure change, needs adapter review" },
  },
];

function matchesHealth(row: SourceRow, health: FixtureHealth): boolean {
  return Object.entries(health).every(([col, expected]) => {
    const actual = row[col as keyof SourceRow];
    return actual instanceof Date ? actual.toISOString() === expected : actual === expected;
  });
}

/**
 * Names that describe a place, not a venue — a venue row with one of these
 * was almost certainly created from a source's city/placeholder location
 * text, and the sync pipeline would then resolve every event reporting that
 * location to it (src/lib/adapters/pipeline.ts uses resolveVenue).
 */
const PLACE_NOT_VENUE = new Set(
  [
    "copenhagen", "kobenhavn", "københavn", "copenhagen denmark", "kobenhavn k", "københavn k", "cph", "kbh",
    "frederiksberg", "denmark", "danmark", "tba", "tbc", "tbd", "secret location", "location tba", "online",
    "various", "various venues", "multiple venues", "unknown",
  ].map(normalizeVenueName),
);

export function isPlaceNotVenue(name: string): boolean {
  return PLACE_NOT_VENUE.has(normalizeVenueName(name));
}

export function evaluateSnapshot(s: Snapshot): Finding[] {
  const findings: Finding[] = [];
  const add = (cls: FindingClass, check: string, detail: string) => findings.push({ class: cls, check, detail });

  for (const e of s.fixtureIdEvents) add("confirmed", "seedDev fixture event id", `${e.id} "${e.title}"`);
  for (const e of s.fixtureLookalikeEvents) {
    if (!FIXTURE_EVENT_IDS.includes(e.id)) add("confirmed", "seedDev fixture event (exact title, start and venue)", `${e.id} "${e.title}"`);
  }
  for (const d of s.fixtureIdDiscovery) add("confirmed", "seedDev fixture discovery id", `${d.id} "${d.probable_title ?? ""}"`);
  for (const d of s.fixtureLookalikeDiscovery) {
    if (!FIXTURE_DISCOVERY_IDS.includes(d.id)) add("confirmed", "seedDev fixture discovery item (exact title and source)", `${d.id} "${d.probable_title ?? ""}"`);
  }
  for (const row of s.sources) {
    if (FIXTURE_SOURCE_HEALTH.some((f) => f.id === row.id && matchesHealth(row, f.health))) {
      add("confirmed", "seedDev staged sync health", `${row.id} carries seedDev's exact staged health values`);
    }
  }

  const dbSourceIds = new Set(s.sources.map((r) => r.id));
  for (const row of s.sources) {
    if (!REGISTRY_SOURCE_IDS.has(row.id)) add("investigate", "source not in the code registry", `${row.id} (src/lib/data/sources.ts has no such id)`);
  }
  for (const id of REGISTRY_SOURCE_IDS) {
    if (!dbSourceIds.has(id)) add("investigate", "registry source missing from the database", `${id} (in src/lib/data/sources.ts; seed it with db:sync-source-registry)`);
  }

  const nonRegistryVenues = s.venues.filter((v) => !REGISTRY_VENUE_IDS.has(v.id));
  for (const v of nonRegistryVenues) {
    if (isPlaceNotVenue(v.name)) {
      add("investigate", "venue named after a place, not a venue", `${v.id} "${v.name}" — ${v.event_count} event(s); sources reporting "${v.name}" as location resolve to it`);
    }
  }
  if (nonRegistryVenues.length > 0) {
    add(
      "info",
      "venues outside the static registry (normal: created in admin)",
      `${nonRegistryVenues.length}: ${nonRegistryVenues.map((v) => `${v.id} (${v.event_count} event${v.event_count === 1 ? "" : "s"})`).join(", ")}`,
    );
  }

  for (const r of s.recency) {
    const shown = r.shown.length < r.total ? `showing the newest ${r.shown.length} of ${r.total} (display limit ${RECENCY_DISPLAY_LIMIT})` : `all ${r.total} shown`;
    add("info", `recent activity: ${r.table}.${r.column} in the last ${RECENCY_DAYS} days`, `${r.total} row(s); ${shown}`);
  }
  return findings;
}

export function verdict(findings: Finding[]): { confirmed: number; investigate: number; failed: boolean; line: string } {
  const confirmed = findings.filter((f) => f.class === "confirmed").length;
  const investigate = findings.filter((f) => f.class === "investigate").length;
  const line =
    confirmed > 0
      ? `CONTAMINATION CONFIRMED — ${confirmed} seedDev fixture finding(s).`
      : investigate > 0
        ? `NO CONTAMINATION FOUND — ${investigate} finding(s) need investigation (not contamination by themselves).`
        : "DATABASE CLEAN — no seedDev fixture data, nothing to investigate.";
  return { confirmed, investigate, failed: confirmed > 0, line };
}
