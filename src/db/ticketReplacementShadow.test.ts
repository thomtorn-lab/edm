import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawCandidateEvent, SourceAdapter } from "@/lib/adapters/types";
import { VENUES } from "@/lib/data/venues";
import { runTicketReplacementShadow, withResidentAdvisorFetchGuard } from "./ticketReplacementShadow";

const NOW = new Date("2026-11-01T12:00:00.000Z");

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-ben",
    title: "Ben UFO all night long",
    artists: ["Ben UFO"],
    venue_id: "v-culture-box",
    sub_venue: null,
    start_datetime: "2026-11-07T22:00:00.000Z",
    end_datetime: "2026-11-08T05:00:00.000Z",
    canonical_source_id: "src-culture-box",
    official_event_url: "https://culture-box.com/events/ben-ufo",
    ticket_url: "https://ra.co/events/111",
    resident_advisor_url: null,
    overridden_fields: [],
    published: true,
    admin_unpublish_reason: null,
    ...overrides,
  };
}

function raw(overrides: Partial<RawCandidateEvent> = {}): RawCandidateEvent {
  return {
    sourceId: "src-culture-box",
    sourceUrl: "https://culture-box.com/events/ben-ufo",
    title: "Ben UFO all night long",
    description: "Techno and house all night.",
    artists: ["Ben UFO"],
    startDatetime: "2026-11-07T22:00:00.000Z",
    endDatetime: null,
    venueName: "Culture Box",
    officialEventUrl: "https://culture-box.com/events/ben-ufo",
    ticketUrl: "https://tickets.example/ben-ufo",
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: null,
    priceFrom: null,
    genreHint: null,
    genreConfidenceHint: null,
    ...overrides,
  };
}

/** Records every statement; answers the two SELECTs the runner may issue. */
function recordingClient(events: Record<string, unknown>[], links: Record<string, unknown>[]) {
  const statements: string[] = [];
  return {
    statements,
    async query(sql: string) {
      statements.push(sql);
      if (/FROM events/.test(sql)) return { rows: events };
      if (/FROM source_event_links/.test(sql)) return { rows: links };
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
}

function adapter(candidates: RawCandidateEvent[], onFetch?: () => Promise<void>): () => SourceAdapter {
  return () =>
    ({
      sourceId: "src-culture-box",
      async fetchCandidates() {
        await onFetch?.();
        return candidates;
      },
      lastFetchWasComplete: () => true,
    }) as unknown as SourceAdapter;
}

afterEach(() => vi.unstubAllGlobals());

describe("runTicketReplacementShadow (read-only runner)", () => {
  it("issues only SELECT statements and reports what the rule would do", async () => {
    const client = recordingClient(
      [storedRow(), storedRow({ id: "e-old", start_datetime: "2026-10-03T22:00:00.000Z", end_datetime: "2026-10-04T05:00:00.000Z", official_event_url: "https://culture-box.com/events/old", ticket_url: "https://ra.co/events/100" })],
      [
        { event_id: "e-ben", source_url: "https://culture-box.com/events/ben-ufo" },
        { event_id: "e-old", source_url: "https://culture-box.com/events/old" },
      ],
    );
    const report = await runTicketReplacementShadow(client, {
      sourceId: "src-culture-box",
      venues: VENUES,
      now: NOW,
      createAdapter: adapter([
        raw(),
        raw({ sourceUrl: "https://culture-box.com/events/old", officialEventUrl: "https://culture-box.com/events/old", title: "Old", startDatetime: "2026-10-03T22:00:00.000Z" }),
        raw({ sourceUrl: "https://culture-box.com/events/new", officialEventUrl: "https://culture-box.com/events/new", title: "Brand new night", artists: ["Nobody Known"], startDatetime: "2026-11-20T22:00:00.000Z" }),
      ]),
    });

    expect(client.statements.every((s) => /^\s*SELECT\b/i.test(s))).toBe(true);
    expect(client.statements).toHaveLength(2);
    expect(report.meta).toMatchObject({
      readOnly: true,
      candidatesFetched: 3,
      candidatesWithoutSyncMatch: 1,
      candidatesMatchedToPastEvents: 1,
      residentAdvisorRequestsRefused: 0,
    });
    expect(report.meta.limitations.length).toBeGreaterThan(0);
    expect(report.decisions).toHaveLength(1);
    const [d] = report.decisions;
    expect(d.outcome, d.explanation.join("\n")).toBe("would_replace");
    expect(d.explanation[0]).toBe("sync match: linked -> e-ben");
    expect(report.summary.byOutcome.would_replace).toBe(1);
    expect(report.labelTemplate).toEqual([
      {
        decision_id: d.decisionId,
        outcome: "would_replace",
        withheld_reason: null,
        event_id: "e-ben",
        stored_ticket_url: "https://ra.co/events/111",
        incoming_ticket_url: "https://tickets.example/ben-ufo",
        verdict: null,
        note: "",
      },
    ]);
  });

  it("is reproducible: same input, same report", async () => {
    const run = () =>
      runTicketReplacementShadow(recordingClient([storedRow()], []), { sourceId: "src-culture-box", venues: VENUES, now: NOW, createAdapter: adapter([raw()]) });
    expect(await run()).toEqual(await run());
  });

  it("a match that only rests on a shared ticket URL is withheld", async () => {
    // No source link; the candidate's RA page is the stored ticket link and
    // nothing else connects them, so dedup's shared-URL rule matches "high".
    const client = recordingClient([storedRow({ title: "Saturday", artists: [] })], []);
    const report = await runTicketReplacementShadow(client, {
      sourceId: "src-culture-box",
      venues: VENUES,
      now: NOW,
      createAdapter: adapter([raw({ officialEventUrl: null, title: "Club night", artists: [], residentAdvisorUrl: "https://ra.co/events/111" })]),
    });
    expect(report.decisions).toHaveLength(1);
    expect(report.decisions[0].withheldReason).toBe("ticket_url_only_identity");
  });

  it("refuses every Resident Advisor request made during the live fetch", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      calls.push(input);
      return new Response("ok");
    });
    const client = recordingClient([storedRow()], []);
    const report = await runTicketReplacementShadow(client, {
      sourceId: "src-culture-box",
      venues: VENUES,
      now: NOW,
      createAdapter: adapter([raw()], async () => {
        await fetch("https://culture-box.com/events");
        await expect(fetch("https://ra.co/events/111")).rejects.toThrow(/refuses Resident Advisor/);
        await expect(fetch("https://www.residentadvisor.net/events/1")).rejects.toThrow(/refuses Resident Advisor/);
      }),
    });
    expect(calls).toEqual(["https://culture-box.com/events"]);
    expect(report.meta.residentAdvisorRequestsRefused).toBe(2);
  });

  it("restores the original fetch afterwards, also on error", async () => {
    const original = globalThis.fetch;
    await expect(withResidentAdvisorFetchGuard(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(globalThis.fetch).toBe(original);
  });
});

/**
 * Optional real-Postgres check, skipped unless AUDIT_TEST_DATABASE_URL points
 * at a DISPOSABLE server. Creates its own database, applies the real
 * migrations, and runs the report inside beginReadOnlyTransaction (the same
 * BEGIN READ ONLY inspect-source uses): proves the runner's SQL matches the
 * real schema, that a write inside the report's own transaction is rejected,
 * and that no row changes.
 */
const TEST_DB = process.env.AUDIT_TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("against a real Postgres (AUDIT_TEST_DATABASE_URL)", () => {
  it("runs on the real schema inside a read-only transaction and changes nothing", async () => {
    const { Client } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { beginReadOnlyTransaction } = await import("./readOnlyTransaction");
    const path = await import("node:path");

    const name = `ticket_shadow_test_${Date.now()}`;
    const admin = new Client({ connectionString: TEST_DB });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(TEST_DB!);
    url.pathname = `/${name}`;
    const c = new Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await migrate(drizzle(c), { migrationsFolder: path.join(import.meta.dirname, "migrations") });
      await c.query(`INSERT INTO venues (id, slug, name, address, city, postal_code, description) VALUES ('v-culture-box', 'culture-box', 'Culture Box', 'Kronprinsessegade 54', 'Copenhagen', '1306', 'Club')`);
      await c.query(
        `INSERT INTO sources (id, source_name, source_type, base_url, trust_level, sync_frequency) VALUES ('src-culture-box', 'Culture Box', 'official-venue', 'https://culture-box.com', 'high', 'daily')`,
      );
      await c.query(
        `INSERT INTO events (id, slug, title, artists, start_datetime, end_datetime, venue_id, primary_genre, canonical_source_id, official_event_url, ticket_url)
         VALUES ('e-ben', 'e-ben', 'Ben UFO all night long', '{Ben UFO}', '2026-11-07T22:00:00Z', '2026-11-08T05:00:00Z', 'v-culture-box', 'techno', 'src-culture-box',
                 'https://culture-box.com/events/ben-ufo', 'https://ra.co/events/111')`,
      );
      await c.query(
        `INSERT INTO source_event_links (event_id, source_id, source_url, role) VALUES ('e-ben', 'src-culture-box', 'https://culture-box.com/events/ben-ufo', 'official')`,
      );
      const snapshot = async () => JSON.stringify((await c.query("SELECT * FROM events ORDER BY id")).rows);
      const before = await snapshot();

      await beginReadOnlyTransaction(c);
      let writeError: unknown = null;
      const guarded = {
        async query(sql: string, params?: unknown[]) {
          if (writeError === null) {
            await c.query("SAVEPOINT probe");
            try {
              await c.query("UPDATE events SET ticket_url = 'https://evil.example' WHERE id = 'e-ben'");
              writeError = "write was accepted";
            } catch (err) {
              writeError = err;
            }
            await c.query("ROLLBACK TO SAVEPOINT probe");
          }
          return c.query(sql, params);
        },
      };
      const report = await runTicketReplacementShadow(guarded, { sourceId: "src-culture-box", venues: VENUES, now: NOW, createAdapter: adapter([raw()]) });
      await c.query("ROLLBACK");

      expect((writeError as { code?: string }).code).toBe("25006");
      expect(report.decisions.map((d) => [d.eventId, d.outcome])).toEqual([["e-ben", "would_replace"]]);
      expect(await snapshot()).toBe(before);
    } finally {
      await c.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    }
  });
});
