import { describe, expect, it } from "vitest";
import { DISCOVERY_QUEUE } from "@/lib/data/discoveryQueue";
import { EVENTS } from "@/lib/data/events";
import { SOURCES } from "@/lib/data/sources";
import { VENUES } from "@/lib/data/venues";
import {
  FIXTURE_DISCOVERY_IDS,
  FIXTURE_EVENT_IDS,
  RECENCY_DISPLAY_LIMIT,
  evaluateSnapshot,
  isPlaceNotVenue,
  verdict,
  type Snapshot,
  type SourceRow,
} from "./verifyDbReadonly";
import { formatReport, readSnapshot } from "./verifyDbReadonlyCli";

/**
 * "Verify Database (Read-Only)" rules (2026-10-25): seedDev fixture data
 * still fails the run; sources/venues added since the 2026-08 lists were
 * hardcoded no longer do.
 */

/** A source row as a real sync leaves it (real, non-fixture timestamps). */
function synced(id: string): SourceRow {
  const at = new Date("2026-10-25T05:09:10.141Z");
  return { id, last_successful_sync: at, last_attempted_sync: at, last_error: null, events_found: 17, events_updated: 17 };
}
function neverSynced(id: string): SourceRow {
  return { id, last_successful_sync: null, last_attempted_sync: null, last_error: null, events_found: 0, events_updated: 0 };
}

/** Shaped like the 2026-10-25 Production run: every registry source, registry venues plus admin-created ones, recent sync activity. */
function productionLike(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    fixtureIdEvents: [],
    fixtureLookalikeEvents: [],
    fixtureIdDiscovery: [],
    fixtureLookalikeDiscovery: [],
    sources: SOURCES.map((s, i) => (i % 2 ? synced(s.id) : neverSynced(s.id))),
    venues: [
      ...VENUES.map((v) => ({ id: v.id, name: v.name, event_count: 3 })),
      { id: "v-royal-arena", name: "Royal Arena", event_count: 4 },
      { id: "v-forum", name: "Forum", event_count: 1 },
      { id: "v-stengade", name: "Stengade", event_count: 0 },
    ],
    recency: [
      { table: "events", column: "updated_at", total: 57, shown: Array.from({ length: RECENCY_DISPLAY_LIMIT }, (_, i) => ({ id: `e-${i}`, at: new Date() })) },
      { table: "venues", column: "updated_at", total: 0, shown: [] },
    ],
    totals: { events: 331, discovery_queue: 1324, venues: VENUES.length + 3, sources: SOURCES.length },
    ...overrides,
  };
}

const classes = (s: Snapshot) => {
  const f = evaluateSnapshot(s);
  return { f, confirmed: f.filter((x) => x.class === "confirmed"), investigate: f.filter((x) => x.class === "investigate"), v: verdict(f) };
};

describe("fixtures come from the modules seedDev inserts", () => {
  it("covers every fixture event and discovery id", () => {
    expect(FIXTURE_EVENT_IDS).toEqual(EVENTS.map((e) => e.id));
    expect(FIXTURE_EVENT_IDS).toContain("e-001");
    expect(FIXTURE_EVENT_IDS).toContain("e-052");
    expect(FIXTURE_DISCOVERY_IDS).toEqual(["dq-001", "dq-002", "dq-003"]);
    expect(DISCOVERY_QUEUE).toHaveLength(3);
  });
});

describe("legitimate Production activity is not contamination (regression: 2026-08 hardcoded lists)", () => {
  it("sources onboarded since August, admin-created venues and recent syncs pass, with nothing to investigate", () => {
    const { confirmed, investigate, v } = classes(productionLike());
    expect(confirmed).toEqual([]);
    expect(investigate).toEqual([]);
    expect(v.failed).toBe(false);
    expect(v.line).toMatch(/^DATABASE CLEAN/);
  });

  it("the eight sources the old check flagged are in the code registry", () => {
    for (const id of ["src-alice", "src-bolsjefabrikken", "src-hvaderpaa", "src-klub-werkstatt", "src-kultunaut", "src-poolen", "src-pumpehuset", "src-pylonen"]) {
      expect(SOURCES.some((s) => s.id === id)).toBe(true);
    }
  });

  it("admin-created venues are listed as normal activity, with their event counts", () => {
    const { f } = classes(productionLike());
    const info = f.find((x) => x.check.startsWith("venues outside the static registry"));
    expect(info?.class).toBe("info");
    expect(info?.detail).toContain("v-royal-arena (4 events)");
    expect(info?.detail).toContain("v-stengade (0 events)");
  });

  it("a registry source whose real sync health happens to share fixture counts but not timestamps is not flagged", () => {
    const sources = SOURCES.map((s) => (s.id === "src-hangaren" ? { ...synced(s.id), events_found: 9, events_updated: 1 } : neverSynced(s.id)));
    expect(classes(productionLike({ sources })).confirmed).toEqual([]);
  });
});

describe("real seedDev contamination still fails the run", () => {
  it("a fixture event id", () => {
    const { confirmed, v } = classes(productionLike({ fixtureIdEvents: [{ id: "e-001", title: "Low Signal" }] }));
    expect(confirmed.map((c) => c.check)).toEqual(["seedDev fixture event id"]);
    expect(v.failed).toBe(true);
    expect(v.line).toMatch(/^CONTAMINATION CONFIRMED/);
  });

  it("a fixture event under another id (exact title, start and venue)", () => {
    const { confirmed, v } = classes(productionLike({ fixtureLookalikeEvents: [{ id: "e-1a2b3c4d", title: "Low Signal" }] }));
    expect(confirmed).toHaveLength(1);
    expect(v.failed).toBe(true);
  });

  it("does not double-count a fixture id that also matches its own signature", () => {
    const row = { id: "e-001", title: "Low Signal" };
    expect(classes(productionLike({ fixtureIdEvents: [row], fixtureLookalikeEvents: [row] })).confirmed).toHaveLength(1);
  });

  it("a fixture discovery item, by id or by exact title and source", () => {
    expect(classes(productionLike({ fixtureIdDiscovery: [{ id: "dq-002", probable_title: "Box Standard — Extended" }] })).v.failed).toBe(true);
    expect(classes(productionLike({ fixtureLookalikeDiscovery: [{ id: "dq-9f9f9f9f", probable_title: "Friday Basement Thing" }] })).v.failed).toBe(true);
  });

  it("today's staged source health (src/lib/data/sources.ts) and the August values the first version checked", () => {
    const hangaren = SOURCES.find((s) => s.id === "src-hangaren")!;
    const staged: SourceRow = {
      id: "src-hangaren",
      last_successful_sync: new Date(hangaren.lastSuccessfulSync!),
      last_attempted_sync: new Date(hangaren.lastAttemptedSync!),
      last_error: null,
      events_found: hangaren.eventsFound,
      events_updated: hangaren.eventsUpdated,
    };
    const august: SourceRow = { id: "src-culture-box", last_successful_sync: new Date("2026-08-13T05:00:00.000Z"), last_attempted_sync: null, last_error: null, events_found: 14, events_updated: 2 };
    for (const row of [staged, august]) {
      const sources = SOURCES.map((s) => (s.id === row.id ? row : neverSynced(s.id)));
      const { confirmed, v } = classes(productionLike({ sources }));
      expect(confirmed.map((c) => c.check)).toEqual(["seedDev staged sync health"]);
      expect(v.failed).toBe(true);
    }
  });
});

describe("needs investigation — reported, but not contamination", () => {
  it("a source outside the code registry", () => {
    const { investigate, v } = classes(productionLike({ sources: [...SOURCES.map((s) => neverSynced(s.id)), neverSynced("src-mystery")] }));
    expect(investigate.map((i) => i.detail)).toEqual([expect.stringContaining("src-mystery")]);
    expect(v.failed).toBe(false);
    expect(v.line).toMatch(/^NO CONTAMINATION FOUND — 1 finding/);
  });

  it("a registry source with no database row", () => {
    const { investigate, v } = classes(productionLike({ sources: SOURCES.slice(1).map((s) => neverSynced(s.id)) }));
    expect(investigate.map((i) => i.check)).toEqual(["registry source missing from the database"]);
    expect(v.failed).toBe(false);
  });

  it("a venue named after a place (v-copenhagen), with its event count", () => {
    const base = productionLike();
    const { investigate, v } = classes({ ...base, venues: [...base.venues, { id: "v-copenhagen", name: "Copenhagen", event_count: 2 }] });
    expect(investigate).toHaveLength(1);
    expect(investigate[0].detail).toContain('v-copenhagen "Copenhagen" — 2 event(s)');
    expect(v.failed).toBe(false);
  });

  it("place names: cities and placeholders, not real venues", () => {
    for (const n of ["Copenhagen", "københavn", "KØBENHAVN K", "CPH", "Frederiksberg", "TBA", "Secret location"]) expect(isPlaceNotVenue(n)).toBe(true);
    for (const n of ["Culture Box", "Copenhagen Jazzhouse", "Royal Arena", "KB18", "Forum"]) expect(isPlaceNotVenue(n)).toBe(false);
  });

  it("a registry venue is never flagged, whatever its name", () => {
    const base = productionLike();
    const venues = base.venues.map((v, i) => (i === 0 ? { ...v, name: "Copenhagen" } : v));
    expect(classes({ ...base, venues }).investigate).toEqual([]);
  });
});

describe("report", () => {
  it("separates the three classes and says the recency rows are a display limit", () => {
    const s = productionLike({ fixtureIdEvents: [{ id: "e-001", title: "Low Signal" }] });
    const text = formatReport(s, evaluateSnapshot(s)).join("\n");
    expect(text).toContain("=== CONFIRMED CONTAMINATION (fails the run): 1 ===");
    expect(text).toContain("=== NEEDS INVESTIGATION (warning — not contamination by itself): 0 ===");
    expect(text).toContain("=== NORMAL ACTIVITY (information only):");
    expect(text).toContain("a display limit, not the total");
    expect(text).toContain("events.updated_at: 57 row(s) in the last 3 days, 20 shown");
    expect(text).toContain("showing the newest 20 of 57 (display limit 20)");
  });
});

describe("readSnapshot is read-only", () => {
  it("sends only SELECT statements, with fixture values as bound parameters", async () => {
    const sent: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        sent.push({ sql, params });
        return { rows: /count\(\*\)::int AS total FROM \w+ WHERE/.test(sql) ? [{ total: 0 }] : /AS events/.test(sql) ? [{ events: 0, discovery_queue: 0, venues: 0, sources: 0 }] : [] };
      },
    };
    await readSnapshot(client as never);
    expect(sent.length).toBeGreaterThan(0);
    for (const q of sent) {
      expect(q.sql.trim()).toMatch(/^SELECT /);
      expect(q.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)\b/i);
      expect(q.sql).not.toContain("Low Signal");
    }
    expect(sent.some((q) => (q.params[0] as string[] | undefined)?.includes?.("e-001"))).toBe(true);
  });
});

describe("workflow wiring", () => {
  it("runs the tested CLI, passes DATABASE_URL only through the step env, and stays manual-only", async () => {
    const { readFileSync } = await import("node:fs");
    const wf = readFileSync(".github/workflows/verify-db-readonly.yml", "utf8");
    const code = wf.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(code).toMatch(/env:\n\s+DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}\n\s+run: node --import tsx src\/db\/verifyDbReadonlyCli\.ts\n/);
    expect(code).not.toMatch(/\.env\.local|cat >|(echo|printf)[^\n]*\$\{?DATABASE_URL/); // never writes or prints the value
    expect(code).toMatch(/on:\n\s+workflow_dispatch: \{\}/);
    expect(code).not.toMatch(/schedule:|push:|pull_request/);
  });
});
