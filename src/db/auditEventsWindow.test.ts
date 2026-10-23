import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
  buildAuditWindow,
  edgeFlagsFor,
  findDuplicateCandidates,
  READ_ONLY_TX_STATEMENTS,
  runEventsWindowAudit,
  shortenDescription,
  toScreeningEvent,
  WINDOW_COUNT_SQL,
  WINDOW_EVENTS_SQL,
  WINDOW_PREDICATE_SQL,
  type QueryClient,
  type WindowEventRow,
} from "./auditEventsWindow";

function row(overrides: Partial<WindowEventRow> & { id: string; start: string }): WindowEventRow {
  const { start, ...rest } = overrides;
  return {
    slug: rest.id,
    title: `Event ${rest.id}`,
    artists: [],
    description: null,
    start_datetime: new Date(start),
    end_datetime: null,
    venue_id: "v-test",
    venue_name: "Test Venue",
    sub_venue: null,
    primary_genre: "techno",
    subgenres: ["techno"],
    genre_confidence: "high",
    cancelled: false,
    postponed: false,
    sold_out: false,
    date_changed: false,
    time_changed: false,
    canonical_source_id: "src-test",
    official_event_url: null,
    ticket_url: null,
    resident_advisor_url: null,
    facebook_url: null,
    other_source_urls: [],
    primary_genre_overridden: false,
    subgenres_overridden: false,
    ...rest,
  };
}

describe("buildAuditWindow — Copenhagen-local bounds with the 06:00 cutoff", () => {
  it("Oct 12–18 2026 (CEST, UTC+2) spans Oct 12 00:00 local to Oct 19 06:00 local", () => {
    const w = buildAuditWindow("2026-10-12", "2026-10-18");
    expect(w.startUtc.toISOString()).toBe("2026-10-11T22:00:00.000Z");
    expect(w.endUtc.toISOString()).toBe("2026-10-19T04:00:00.000Z");
  });

  it("is DST-safe: a window ending the night clocks go back (Oct 25 2026) ends 06:00 CET", () => {
    const w = buildAuditWindow("2026-10-24", "2026-10-24");
    expect(w.startUtc.toISOString()).toBe("2026-10-23T22:00:00.000Z");
    expect(w.endUtc.toISOString()).toBe("2026-10-25T05:00:00.000Z");
  });

  it("rejects malformed, impossible, reversed and over-long windows", () => {
    expect(() => buildAuditWindow("2026-10-1", "2026-10-18")).toThrow(/YYYY-MM-DD/);
    expect(() => buildAuditWindow("2026-02-30", "2026-03-01")).toThrow(/Invalid calendar date/);
    expect(() => buildAuditWindow("2026-10-18", "2026-10-12")).toThrow(/before/);
    expect(() => buildAuditWindow("2026-10-01", "2026-11-15")).toThrow(/maximum/);
    expect(() => buildAuditWindow("2026-10-12'; DROP TABLE events; --", "2026-10-18")).toThrow();
  });
});

describe("edge flags", () => {
  const w = buildAuditWindow("2026-10-12", "2026-10-18");

  it("flags a 02:00 start on the first day as the previous night", () => {
    expect(edgeFlagsFor(new Date("2026-10-12T00:00:00Z"), w)).toEqual(["previous_night_early_start"]);
  });

  it("flags a 03:00 start the morning after the last day as the last night's after-midnight", () => {
    expect(edgeFlagsFor(new Date("2026-10-19T01:00:00Z"), w)).toEqual(["after_midnight_last_night"]);
  });

  it("flags a multi-day event that started before the window", () => {
    expect(edgeFlagsFor(new Date("2026-10-10T18:00:00Z"), w)).toEqual(["started_before_window"]);
  });

  it("does not flag an ordinary in-window evening start", () => {
    expect(edgeFlagsFor(new Date("2026-10-16T21:00:00Z"), w)).toEqual([]);
  });
});

describe("SQL — completeness and minimal output", () => {
  it("covers published events from every source, including events with no source", () => {
    expect(WINDOW_PREDICATE_SQL).toMatch(/e\.published = true/);
    expect(WINDOW_PREDICATE_SQL).not.toMatch(/canonical_source_id/);
    expect(WINDOW_EVENTS_SQL).toMatch(/LEFT JOIN venues/);
    expect(WINDOW_EVENTS_SQL).toContain(WINDOW_PREDICATE_SQL);
    expect(WINDOW_COUNT_SQL).toContain(WINDOW_PREDICATE_SQL);
  });

  it("uses an inclusive start, exclusive end, and keeps running multi-day events", () => {
    expect(WINDOW_PREDICATE_SQL).toMatch(/e\.start_datetime < \$2/);
    expect(WINDOW_PREDICATE_SQL).toMatch(/e\.start_datetime >= \$1/);
    expect(WINDOW_PREDICATE_SQL).toMatch(/e\.end_datetime >= \$1/);
  });

  it("selects an explicit column list without admin notes, override fields or histories", () => {
    for (const sql of [WINDOW_EVENTS_SQL, WINDOW_COUNT_SQL]) {
      expect(sql.trim()).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/\b\w+\.\*|SELECT \*/);
      expect(sql).not.toMatch(
        /admin_unpublish|manual_override|event_change_log|discovery_queue|source_cancellation_evidence/,
      );
      // overridden_fields is only ever read through the two genre membership
      // checks (genre QA, 2026-10-17), never selected as a column.
      const overrideUses = sql.match(/[^\n]*overridden_fields[^\n]*/g) ?? [];
      for (const use of overrideUses) {
        expect(use.trim()).toMatch(/^\('(primaryGenre|subgenres)' = ANY\(e\.overridden_fields\)\) AS (primary_genre|subgenres)_overridden,?$/);
      }
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT)\b/i);
    }
  });
});

describe("toScreeningEvent", () => {
  const w = buildAuditWindow("2026-10-12", "2026-10-18");

  it("renders local times, night-of, public URL, deduped source URLs and status flags", () => {
    const e = toScreeningEvent(
      row({
        id: "e-1",
        start: "2026-10-17T22:00:00Z",
        end_datetime: new Date("2026-10-18T04:00:00Z"),
        official_event_url: "https://venue.dk/e1",
        ticket_url: "https://venue.dk/e1",
        resident_advisor_url: "https://ra.co/events/1",
        sold_out: true,
        canonical_source_id: null,
      }),
      w,
    );
    expect(e.startLocal).toBe("2026-10-18 00:00");
    expect(e.endLocal).toBe("2026-10-18 06:00");
    expect(e.nightOf).toBe("2026-10-17");
    expect(e.publicUrl).toBe("https://www.electroniccph.com/events/e-1");
    expect(e.sourceUrls).toEqual(["https://venue.dk/e1", "https://ra.co/events/1"]);
    expect(e.status).toEqual(["sold_out"]);
    expect(e.sourceId).toBeNull();
  });

  it("genre QA (2026-10-17): reports which genre fields an admin set manually, and nothing else about overrides", () => {
    expect(WINDOW_EVENTS_SQL).toContain("('primaryGenre' = ANY(e.overridden_fields)) AS primary_genre_overridden");
    expect(WINDOW_EVENTS_SQL).toContain("('subgenres' = ANY(e.overridden_fields)) AS subgenres_overridden");
    const ev = (o: Partial<WindowEventRow>) => toScreeningEvent(row({ id: "e-g", start: "2026-10-17T22:00:00Z", ...o }), w);
    expect(ev({}).genreManuallySet).toEqual([]);
    expect(ev({ primary_genre_overridden: true }).genreManuallySet).toEqual(["primaryGenre"]);
    expect(ev({ primary_genre_overridden: true, subgenres_overridden: true }).genreManuallySet).toEqual(["primaryGenre", "subgenres"]);
    // overridden_fields NULL/absent in the DB yields NULL from ANY(): treated as not overridden.
    expect(ev({ primary_genre_overridden: null, subgenres_overridden: null }).genreManuallySet).toEqual([]);
    expect(Object.keys(ev({}))).not.toContain("overriddenFields");
  });

  it("shortens and whitespace-collapses descriptions", () => {
    expect(shortenDescription("  a\n\n b  ")).toBe("a b");
    const long = shortenDescription("x".repeat(1000))!;
    expect(long.length).toBe(400);
    expect(long.endsWith("…")).toBe(true);
    expect(shortenDescription("   ")).toBeNull();
  });
});

describe("findDuplicateCandidates", () => {
  it("pairs same-venue same-night events with matching titles", () => {
    const pairs = findDuplicateCandidates([
      row({ id: "a", start: "2026-10-16T21:00:00Z", title: "Ben Klock all night long", artists: ["Ben Klock"] }),
      row({ id: "b", start: "2026-10-16T22:00:00Z", title: "Ben Klock All Night Long", artists: ["Ben Klock"] }),
      row({ id: "c", start: "2026-10-16T21:00:00Z", title: "Completely different", artists: ["Someone Else"] }),
    ]);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([["a", "b"]]);
    expect(pairs[0].confidence).not.toBe("none");
  });

  it("pairs events on different nights that share an official URL (possible wrong date)", () => {
    const pairs = findDuplicateCandidates([
      row({ id: "a", start: "2026-10-13T19:00:00Z", official_event_url: "https://venue.dk/show" }),
      row({ id: "b", start: "2026-10-16T19:00:00Z", ticket_url: "https://venue.dk/show/" }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].confidence).toBe("shared_url");
  });
});

/** Records every statement; answers the two SELECTs with canned rows. */
function fakeClient(
  rows: WindowEventRow[],
  counts: { source_id: string | null; n: number }[],
  failOn?: RegExp,
  readOnly = "on",
) {
  const statements: string[] = [];
  const client: QueryClient = {
    async query(sql: string) {
      statements.push(sql);
      if (failOn && failOn.test(sql)) throw new Error("boom");
      if (sql === READ_ONLY_TX_STATEMENTS.verify) return { rows: [{ transaction_read_only: readOnly }] };
      if (sql === WINDOW_EVENTS_SQL) return { rows };
      if (sql === WINDOW_COUNT_SQL) return { rows: counts };
      return { rows: [] };
    },
  };
  return { client, statements };
}

const ALLOWED_STATEMENTS = [
  "BEGIN READ ONLY",
  "SET LOCAL statement_timeout = '25s'",
  "SHOW transaction_read_only",
  WINDOW_EVENTS_SQL,
  WINDOW_COUNT_SQL,
  "ROLLBACK",
];

describe("runEventsWindowAudit — read-only transaction", () => {
  const w = buildAuditWindow("2026-10-12", "2026-10-18");
  const rows = [
    row({ id: "e-src", start: "2026-10-16T21:00:00Z" }),
    row({ id: "e-none", start: "2026-10-17T21:00:00Z", canonical_source_id: null }),
  ];

  it("opens a read-only transaction, sends only SELECTs, and always rolls back", async () => {
    const { client, statements } = fakeClient(rows, [
      { source_id: null, n: 1 },
      { source_id: "src-test", n: 1 },
    ]);
    const report = await runEventsWindowAudit(client, w);
    expect(statements).toEqual(ALLOWED_STATEMENTS);
    expect(report.totalPublishedInWindow).toBe(2);
    expect(report.completenessCheck).toBe("ok");
    expect(report.events.map((e) => e.id)).toEqual(["e-src", "e-none"]);
    expect(report.countBySource).toContainEqual({ sourceId: null, count: 1 });
  });

  it("reports a mismatch when the independent count disagrees with the rows", async () => {
    const { client } = fakeClient(rows, [{ source_id: "src-test", n: 3 }]);
    expect((await runEventsWindowAudit(client, w)).completenessCheck).toBe("mismatch");
  });

  it("refuses to query when the transaction is not actually read-only", async () => {
    const { client, statements } = fakeClient(rows, [], undefined, "off");
    await expect(runEventsWindowAudit(client, w)).rejects.toThrow(/transaction_read_only/);
    expect(statements).not.toContain(WINDOW_EVENTS_SQL);
    expect(statements.at(-1)).toBe("ROLLBACK");
  });

  it("rolls back and rethrows when a query fails", async () => {
    const { client, statements } = fakeClient(rows, [], /^SELECT e\.id/);
    await expect(runEventsWindowAudit(client, w)).rejects.toThrow("boom");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements.every((s) => ALLOWED_STATEMENTS.includes(s))).toBe(true);
  });
});

describe("audit-events-window-readonly.yml", () => {
  const yaml = readFileSync(
    path.join(__dirname, "..", "..", ".github", "workflows", "audit-events-window-readonly.yml"),
    "utf-8",
  );
  const onBlock = yaml.slice(yaml.indexOf("\non:"), yaml.indexOf("\npermissions:"));

  it("is manual-only with read-only repository permissions", () => {
    expect(onBlock).toMatch(/workflow_dispatch:/);
    expect(onBlock).not.toMatch(/\b(schedule|push|pull_request|workflow_run|repository_dispatch):/);
    expect(yaml).toMatch(/permissions:\n {2}contents: read\n/);
  });

  it("never interpolates inputs into run: scripts and never writes the secret to disk", () => {
    const inputRefs = yaml.split("\n").filter((l) => l.includes("${{ inputs."));
    expect(inputRefs.length).toBeGreaterThan(0);
    for (const line of inputRefs) expect(line).toMatch(/^\s+INPUT_[A-Z_]+: \$\{\{ inputs\.[a-z_]+ \}\}$/);
    expect(yaml).not.toMatch(/\.env\.local/);
    expect(yaml).toMatch(/node --import tsx src\/db\/auditEventsWindowCli\.ts --from="\$INPUT_FROM_DATE" --to="\$INPUT_TO_DATE"/);
  });
});

/**
 * Optional real-Postgres check, skipped unless AUDIT_TEST_DATABASE_URL points
 * at a DISPOSABLE database. It creates its own throwaway schema (regular,
 * non-temp tables — Postgres lets read-only transactions write temp tables,
 * which would hide a broken guard) and drops it afterwards. Proves against
 * real Postgres that the window is complete at its edges, includes
 * source-less events, excludes unpublished ones, and that the audit's own
 * transaction rejects writes.
 */
const TEST_DB = process.env.AUDIT_TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("against a real Postgres (AUDIT_TEST_DATABASE_URL)", () => {
  it("returns exactly the in-window published rows inside a transaction that rejects writes", async () => {
    const client = new Client({ connectionString: TEST_DB });
    const schema = `audit_window_test_${Date.now()}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE venues (id text PRIMARY KEY, name text NOT NULL)`);
      await client.query(`CREATE TABLE events (
        id text PRIMARY KEY, slug text NOT NULL, title text NOT NULL, artists text[] NOT NULL DEFAULT '{}',
        description text, start_datetime timestamptz NOT NULL, end_datetime timestamptz,
        venue_id text, sub_venue text, primary_genre text NOT NULL DEFAULT 'techno',
        subgenres text[] NOT NULL DEFAULT '{}', genre_confidence text NOT NULL DEFAULT 'high',
        cancelled boolean NOT NULL DEFAULT false, postponed boolean NOT NULL DEFAULT false,
        sold_out boolean NOT NULL DEFAULT false, date_changed boolean NOT NULL DEFAULT false,
        time_changed boolean NOT NULL DEFAULT false, published boolean NOT NULL DEFAULT true,
        canonical_source_id text, official_event_url text, ticket_url text, resident_advisor_url text,
        facebook_url text, other_source_urls text[] NOT NULL DEFAULT '{}',
        overridden_fields text[] NOT NULL DEFAULT '{}')`);
      await client.query(`CREATE TABLE artist_genre_cache (
        artist_name_normalized text PRIMARY KEY, lookup_status text NOT NULL, proposed_genre text, genre_confidence text,
        identity_confidence text, discogs_artist_id integer, evidence jsonb NOT NULL DEFAULT '[]', classification_method text NOT NULL,
        looked_up_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL)`);
      await client.query(`INSERT INTO venues VALUES ('v1', 'Venue One')`);
      const ins = (id: string, start: string, opts: { end?: string; published?: boolean; source?: string | null } = {}) =>
        client.query(
          `INSERT INTO events (id, slug, title, start_datetime, end_datetime, venue_id, published, canonical_source_id)
           VALUES ($1, $1, $1, $2, $3, 'v1', $4, $5)`,
          [id, start, opts.end ?? null, opts.published ?? true, opts.source === undefined ? "src-x" : opts.source],
        );
      await ins("before-start", "2026-10-11T21:59:59Z"); // Oct 11 23:59:59 local — out
      await ins("at-start", "2026-10-11T22:00:00Z"); // Oct 12 00:00 local — in (flagged)
      await ins("last-night-0559", "2026-10-19T03:59:00Z"); // Oct 19 05:59 local — in (flagged)
      await ins("at-end", "2026-10-19T04:00:00Z"); // Oct 19 06:00 local — out
      await ins("no-source", "2026-10-15T20:00:00Z", { source: null }); // admin-pasted — in
      await ins("unpublished", "2026-10-15T20:00:00Z", { published: false }); // out
      await ins("running-festival", "2026-10-10T12:00:00Z", { end: "2026-10-12T20:00:00Z" }); // in (flagged)
      await ins("ended-festival", "2026-10-09T12:00:00Z", { end: "2026-10-11T20:00:00Z" }); // out
      await client.query(`UPDATE events SET overridden_fields = '{primaryGenre,ticketUrl}' WHERE id = 'no-source'`);
      await client.query(`UPDATE events SET artists = '{Ben Klock}' WHERE id = 'no-source'`);
      await client.query(
        `INSERT INTO artist_genre_cache (artist_name_normalized, lookup_status, proposed_genre, genre_confidence, classification_method, expires_at)
         VALUES ('ben klock', 'found', 'techno', 'medium', 'discogs-artist-releases@v1', '2026-01-01T00:00:00Z')`,
      );

      // Wrap the real client: right before the audit's first SELECT, try a
      // write inside the audit's OWN transaction and require Postgres to
      // reject it (savepoint keeps the transaction usable afterwards).
      let writeError: unknown = null;
      const probing: QueryClient = {
        async query(sql: string, params?: unknown[]) {
          if (sql === WINDOW_EVENTS_SQL) {
            await client.query("SAVEPOINT probe");
            try {
              await client.query(`UPDATE events SET title = 'written'`);
            } catch (err) {
              writeError = err;
            }
            await client.query("ROLLBACK TO SAVEPOINT probe");
          }
          return client.query(sql, params);
        },
      };

      const report = await runEventsWindowAudit(probing, buildAuditWindow("2026-10-12", "2026-10-18"));
      expect(String(writeError)).toMatch(/read-only transaction/);
      expect(report.events.map((e) => e.id).sort()).toEqual(
        ["at-start", "last-night-0559", "no-source", "running-festival"].sort(),
      );
      expect(report.completenessCheck).toBe("ok");
      expect(report.countBySource).toContainEqual({ sourceId: null, count: 1 });
      // Relevance recheck (2026-10-17): present for every event, labelled as a current recomputation.
      for (const e of report.events) expect(e.relevanceRecheck?.basis).toMatch(/NOT the historical publish decision/);
      // The cached (expired) Discogs row is read through the real cache query.
      expect(report.events.find((e) => e.id === "no-source")?.relevanceRecheck?.discogsGenre).toBe("techno");
      // Genre QA (2026-10-17): only the genre override is reported, never ticketUrl.
      expect(report.events.find((e) => e.id === "no-source")?.genreManuallySet).toEqual(["primaryGenre"]);
      expect(report.events.find((e) => e.id === "at-start")?.genreManuallySet).toEqual([]);
      const titles = await client.query(`SELECT count(*)::int AS n FROM events WHERE title = 'written'`);
      expect(titles.rows[0].n).toBe(0);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
      await client.end();
    }
  });
});
