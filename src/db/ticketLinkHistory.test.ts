import { describe, expect, it } from "vitest";
import { TICKET_HISTORY_SQL, runTicketLinkHistory } from "./ticketLinkHistory";

const NOW = new Date("2026-10-23T12:00:00.000Z");

type Log = [eventId: string, by: string, type: string, fields: string[], at: string, note?: string];

// Synthetic history covering every pattern the analysis distinguishes.
const LOG: Log[] = [
  // e-poolen: Billetto and Poolen keep overwriting each other (flip-flop).
  ["e-poolen", "src-poolen", "create", ["title", "ticketUrl"], "2026-10-01T00:15:00Z"],
  ["e-poolen", "src-billetto", "sync", ["ticketUrl"], "2026-10-01T00:45:00Z"],
  ["e-poolen", "src-poolen", "sync", ["ticketUrl"], "2026-10-01T06:15:00Z"],
  ["e-poolen", "src-billetto", "sync", ["ticketUrl"], "2026-10-01T06:45:00Z"],
  ["e-poolen", "src-poolen", "sync", ["ticketUrl"], "2026-10-01T12:15:00Z"],
  ["e-poolen", "src-poolen", "sync", [], "2026-10-01T18:15:00Z"],
  // e-hangaren: the official source's own value changed twice.
  ["e-hangaren", "src-hangaren", "create", ["title", "ticketUrl"], "2026-10-02T00:00:00Z"],
  ["e-hangaren", "src-hangaren", "sync", ["ticketUrl"], "2026-10-02T06:00:00Z"],
  ["e-hangaren", "src-hangaren", "sync", ["ticketUrl", "title"], "2026-10-02T12:00:00Z"],
  // e-admin: admin set the link; later syncs were blocked by the override.
  ["e-admin", "src-culture-box", "create", ["title", "ticketUrl"], "2026-10-03T00:30:00Z"],
  ["e-admin", "admin", "update", ["ticketUrl"], "2026-10-03T08:00:00Z"],
  ["e-admin", "src-culture-box", "sync", [], "2026-10-03T12:30:00Z", "skipped manually-overridden fields: ticketUrl"],
  // e-pump: an aggregator overwrote Pumpehuset's link and it was never restored.
  ["e-pump", "src-pumpehuset", "create", ["title", "ticketUrl"], "2026-10-04T00:50:00Z"],
  ["e-pump", "src-pumpehuset", "sync", ["ticketUrl"], "2026-10-04T06:50:00Z"],
  ["e-pump", "src-kultunaut", "sync", ["ticketUrl"], "2026-10-04T07:35:00Z"],
  ["e-pump", "src-pumpehuset", "sync", [], "2026-10-04T12:50:00Z"],
  // e-quiet: synced often, ticket link never changed.
  ["e-quiet", "src-alice", "create", ["title", "ticketUrl"], "2026-10-05T00:05:00Z"],
  ["e-quiet", "src-alice", "sync", [], "2026-10-05T06:05:00Z"],
];

const EVENTS = [
  { id: "e-poolen", title: "Poolen night", venue_id: "v-poolen", start_datetime: "2026-11-01T21:00:00Z", canonical_source_id: "src-poolen", ticket_url: "https://www.ticketmaster.dk/event/1", overridden_fields: [], published: true },
  { id: "e-hangaren", title: "Hangaren night", venue_id: "v-hangaren", start_datetime: "2026-09-01T21:00:00Z", canonical_source_id: "src-hangaren", ticket_url: "https://ra.co/events/1", overridden_fields: [], published: true },
  { id: "e-admin", title: "Admin night", venue_id: "v-culture-box", start_datetime: "2026-11-02T21:00:00Z", canonical_source_id: "src-culture-box", ticket_url: "https://tickets.example/a", overridden_fields: ["ticketUrl"], published: true },
  { id: "e-pump", title: "Pumpehuset night", venue_id: "v-pumpehuset", start_datetime: "2026-11-03T21:00:00Z", canonical_source_id: "src-pumpehuset", ticket_url: "https://kultunaut.example/t", overridden_fields: [], published: true },
  { id: "e-quiet", title: "Quiet", venue_id: "v-alice", start_datetime: "2026-11-04T21:00:00Z", canonical_source_id: "src-alice", ticket_url: null, overridden_fields: [], published: true },
];

/** Answers the runner's five SELECTs from LOG/EVENTS the way Postgres would, and records every statement. */
function fakeClient() {
  const statements: string[] = [];
  const rows = LOG.map(([event_id, changed_by, change_type, fields_changed, created_at, note], i) => ({ id: `l${i}`, event_id, changed_by, change_type, fields_changed, created_at, note: note ?? null }));
  return {
    statements,
    async query(sql: string) {
      statements.push(sql);
      if (sql === TICKET_HISTORY_SQL.coverage) return { rows: [{ first_at: rows[0].created_at, last_at: rows.at(-1)!.created_at, n: rows.length }] };
      if (sql === TICKET_HISTORY_SQL.byType) {
        const m = new Map<string, number>();
        for (const r of rows) m.set(r.change_type, (m.get(r.change_type) ?? 0) + 1);
        return { rows: [...m].map(([change_type, n]) => ({ change_type, n })) };
      }
      if (sql === TICKET_HISTORY_SQL.ticketRows) return { rows: rows.filter((r) => r.fields_changed.includes("ticketUrl") || (r.note ?? "").includes("ticketUrl")) };
      if (sql === TICKET_HISTORY_SQL.observations) {
        const m = new Map<string, number>();
        for (const r of rows.filter((x) => x.change_type === "sync")) m.set(`${r.event_id}|${r.changed_by}`, (m.get(`${r.event_id}|${r.changed_by}`) ?? 0) + 1);
        return { rows: [...m].map(([k, syncs]) => ({ event_id: k.split("|")[0], changed_by: k.split("|")[1], syncs })) };
      }
      if (sql === TICKET_HISTORY_SQL.events) return { rows: EVENTS };
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
}

describe("ticket-link history analysis", () => {
  it("issues only SELECT statements", async () => {
    const client = fakeClient();
    await runTicketLinkHistory(client, NOW);
    expect(client.statements).toHaveLength(5);
    expect(client.statements.every((s) => /^\s*SELECT\b/i.test(s))).toBe(true);
  });

  it("counts writes and distinct events, flip-flops, overwrites and override blocks", async () => {
    const r = await runTicketLinkHistory(fakeClient(), NOW);
    expect(r.totals).toEqual({
      syncTicketWrites: 8,
      eventsWithSyncTicketWrites: 3,
      adminTicketWrites: 1,
      eventsWithAdminTicketWrites: 1,
      overrideBlocks: 1,
      eventsWithOverrideBlocks: 1,
      eventsWithMultipleSyncWriters: 2,
      officialOverwrites: 2,
      eventsWithOfficialOverwrites: 2,
      restoredByOfficial: 1,
      eventsWithFlipFlop: 1,
      sameSourceRewrites: 1,
      eventsWithSameSourceRewrites: 1,
      eventsCurrentlyNonOfficialWhileOfficialSyncs: 1,
    });
    expect(r.coverage).toMatchObject({ totalLogRows: LOG.length, rowsByType: { create: 5, sync: 12, update: 1 } });
  });

  it("reports the writer sequence per event, never a value", async () => {
    const r = await runTicketLinkHistory(fakeClient(), NOW);
    const poolen = r.events.find((e) => e.eventId === "e-poolen")!;
    expect(poolen.writes.map((w) => w.by)).toEqual(["src-billetto", "src-poolen", "src-billetto", "src-poolen"]);
    expect(poolen).toMatchObject({ createdBy: "src-poolen", officialOverwrites: 1, restoredByOfficial: 1, lastWriter: "src-poolen", currentTicketHost: "www.ticketmaster.dk", upcoming: true });
    const pump = r.events.find((e) => e.eventId === "e-pump")!;
    expect(pump).toMatchObject({ officialOverwrites: 1, restoredByOfficial: 0, lastWriter: "src-kultunaut", officialObservers: ["src-pumpehuset"] });
    expect(r.events.find((e) => e.eventId === "e-hangaren")).toMatchObject({ sameSourceRewrites: 1, upcoming: false });
    expect(r.events.find((e) => e.eventId === "e-quiet")).toBeUndefined();
    expect(JSON.stringify(r.events)).not.toContain("https://");
  });

  it("groups by source, source pair and venue", async () => {
    const r = await runTicketLinkHistory(fakeClient(), NOW);
    expect(r.bySource.find((s) => s.source === "src-billetto")).toEqual({ source: "src-billetto", authority: "ticketing", syncTicketWrites: 2, events: 1, syncObservations: 2, eventsObserved: 1 });
    expect(r.bySourcePair).toEqual([
      { from: "src-billetto", to: "src-poolen", writes: 2, events: 1 },
      { from: "src-poolen", to: "src-billetto", writes: 1, events: 1 },
      { from: "src-pumpehuset", to: "src-kultunaut", writes: 1, events: 1 },
    ]);
    expect(r.byVenue.find((v) => v.venueId === "v-poolen")).toEqual({ venueId: "v-poolen", eventsWithSyncTicketWrites: 1, eventsWithFlipFlop: 1, syncTicketWrites: 4 });
  });

  it("always carries the limitations, including that values were never logged", async () => {
    const r = await runTicketLinkHistory(fakeClient(), NOW);
    expect(r.limitations.join(" ")).toMatch(/never old or new values/);
    expect(r.limitations.join(" ")).toMatch(/origin of a ticket link has never been stored/);
  });
});

/**
 * Optional real-Postgres check (AUDIT_TEST_DATABASE_URL, DISPOSABLE server):
 * real migrations, the same synthetic history, run inside
 * beginReadOnlyTransaction. Proves the SQL matches the real schema, that a
 * write in the analysis' own transaction is rejected, and that nothing
 * changes.
 */
const TEST_DB = process.env.AUDIT_TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("against a real Postgres (AUDIT_TEST_DATABASE_URL)", () => {
  it("runs on the real schema inside a read-only transaction and changes nothing", async () => {
    const { Client } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { beginReadOnlyTransaction } = await import("./readOnlyTransaction");
    const path = await import("node:path");

    const name = `ticket_history_test_${Date.now()}`;
    const admin = new Client({ connectionString: TEST_DB });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(TEST_DB!);
    url.pathname = `/${name}`;
    const c = new Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await migrate(drizzle(c), { migrationsFolder: path.join(import.meta.dirname, "migrations") });
      for (const v of ["v-poolen", "v-hangaren", "v-culture-box", "v-pumpehuset", "v-alice"]) {
        await c.query(`INSERT INTO venues (id, slug, name, address, city, postal_code, description) VALUES ($1, $1, $1, 'a', 'Copenhagen', '1000', 'd')`, [v]);
      }
      for (const e of EVENTS) {
        await c.query(
          `INSERT INTO events (id, slug, title, start_datetime, venue_id, primary_genre, canonical_source_id, ticket_url, overridden_fields)
           VALUES ($1, $1, $2, $3, $4, 'techno', NULL, $5, $6)`,
          [e.id, e.title, e.start_datetime, e.venue_id, e.ticket_url, e.overridden_fields],
        );
      }
      for (const [i, [eventId, by, type, fields, at, note]] of LOG.entries()) {
        await c.query(
          `INSERT INTO event_change_log (id, event_id, changed_by, change_type, fields_changed, note, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [`l${String(i).padStart(3, "0")}`, eventId, by, type, fields, note ?? null, at],
        );
      }
      const snapshot = async () =>
        JSON.stringify([(await c.query("SELECT * FROM events ORDER BY id")).rows, (await c.query("SELECT * FROM event_change_log ORDER BY id")).rows]);
      const before = await snapshot();

      await beginReadOnlyTransaction(c);
      await c.query("SAVEPOINT probe");
      const writeError = await c.query("DELETE FROM event_change_log").then(
        () => null,
        (err: { code?: string }) => err,
      );
      await c.query("ROLLBACK TO SAVEPOINT probe");
      const report = await runTicketLinkHistory(c, NOW);
      await c.query("ROLLBACK");

      expect(writeError?.code).toBe("25006");
      expect(report.totals.eventsWithFlipFlop).toBe(1);
      expect(report.totals.syncTicketWrites).toBe(8);
      expect(report.coverage.totalLogRows).toBe(LOG.length);
      expect(await snapshot()).toBe(before);
    } finally {
      await c.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    }
  });
});
