import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BEGIN_SQL,
  buildQaSnapshot,
  CHANGES_SQL,
  EVENTS_COUNT_SQL,
  EVENTS_SQL,
  LINKS_SQL,
  QA_EXPORT_TABLES,
  QA_PREFILTER_LOOKBACK_MS,
  runQaExport,
  SOURCES_SQL,
  TIMEOUT_SQL,
  type QaRawData,
} from "./exportQaSnapshot";
import { GUARD_STATEMENTS, SHARED_REPORT_RO_TABLES } from "./reportReadOnlyGuard";

vi.mock("@/db/client", () => ({ db: {} }));
const { UPCOMING_PREFILTER_LOOKBACK_MS } = await import("@/lib/queries");

const NOW = new Date("2026-11-21T22:00:00.000Z"); // Saturday 23:00 Copenhagen

function event(id: string, start: string, end: string | null, extra: Record<string, unknown> = {}) {
  return {
    id, slug: `${id}-slug`, title: `Event ${id}`, description: null, artists: ["A", "B"],
    start_datetime: new Date(start), end_datetime: end ? new Date(end) : null, timezone: "Europe/Copenhagen",
    venue_id: "v-1", venue_name: "Venue", venue_slug: "venue", sub_venue: null,
    primary_genre: "techno", subgenres: ["techno"], genre_confidence: "high",
    official_event_url: "https://venue.example/e", ticket_url: null, facebook_url: null, resident_advisor_url: null, other_source_urls: [],
    sold_out: false, cancelled: false, postponed: false, date_changed: false, time_changed: false,
    canonical_source_id: "src-1", manual_override: false, overridden_fields: [],
    created_at: new Date("2026-11-01T00:00:00Z"), updated_at: new Date("2026-11-20T00:00:00Z"), last_source_check: null, last_changed: null,
    ...extra,
  };
}

function raw(overrides: Partial<QaRawData> = {}): QaRawData {
  const events = overrides.events ?? [
    event("past", "2026-11-19T22:00:00Z", "2026-11-20T04:00:00Z"),
    event("running", "2026-11-21T21:00:00Z", "2026-11-22T05:00:00Z"),
    event("running-no-end", "2026-11-21T20:00:00Z", null),
    event("future", "2026-11-28T22:00:00Z", null),
  ];
  return {
    events,
    prefilterCount: overrides.prefilterCount ?? events.length,
    links: overrides.links ?? [{ event_id: "future", source_id: "src-1", source_url: "https://venue.example/e", role: "official", first_seen_at: new Date("2026-11-02T00:00:00Z") }],
    changes: overrides.changes ?? [{ id: "c1", event_id: "future", changed_by: "src-1", change_type: "sync", fields_changed: ["artists"], created_at: new Date("2026-11-10T00:00:00Z") }],
    sources: overrides.sources ?? [{ id: "src-1", source_name: "Venue", source_type: "venue", active: true }],
  };
}

describe("buildQaSnapshot", () => {
  it("keeps upcoming and in-progress events and drops past ones, by the site's definition", () => {
    const s = buildQaSnapshot(raw(), NOW);
    expect(s.events.map((e) => e.id)).toEqual(["running", "running-no-end", "future"]);
    expect(s.events.map((e) => e.in_progress)).toEqual([true, true, false]);
    expect(s.counts).toEqual({ events: 3, in_progress: 2, source_links: 1, change_log: 1, sources: 1 });
    expect(s.validation.passed).toBe(true);
  });

  it("uses the same SQL pre-filter window as the public lists", () => {
    expect(QA_PREFILTER_LOOKBACK_MS).toBe(UPCOMING_PREFILTER_LOOKBACK_MS);
  });

  it("nests source links and change log per event, with a stable page URL", () => {
    const e = buildQaSnapshot(raw(), NOW).events.find((x) => x.id === "future")!;
    expect(e.page_url).toBe("https://www.electroniccph.com/events/future-slug");
    expect(e.source_links).toEqual([{ source_id: "src-1", source_url: "https://venue.example/e", role: "official", first_seen_at: "2026-11-02T00:00:00.000Z" }]);
    expect(e.change_log[0]).toMatchObject({ change_type: "sync", fields_changed: ["artists"] });
  });

  it("changes the fingerprint when QA-relevant content changes, not when only timestamps do", () => {
    const fp = (extra: Record<string, unknown>) =>
      buildQaSnapshot(raw({ events: [event("future", "2026-11-28T22:00:00Z", null, extra)] }), NOW).events[0].content_fingerprint;
    const base = fp({});
    expect(fp({ updated_at: new Date("2026-11-21T00:00:00Z"), last_source_check: new Date() })).toBe(base);
    expect(fp({ artists: ["A", "C"] })).not.toBe(base);
    expect(fp({ ticket_url: "https://tickets.example/x" })).not.toBe(base);
    expect(fp({ subgenres: ["house"] })).not.toBe(base);
  });

  it("fails validation on a count mismatch, duplicate ids, a missing venue or unknown sources", () => {
    const failed = (r: QaRawData) => buildQaSnapshot(r, NOW).validation.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed(raw({ prefilterCount: 99 }))).toEqual(["row_count_matches_independent_count"]);
    const dup = event("future", "2026-11-28T22:00:00Z", null);
    expect(failed(raw({ events: [dup, { ...dup, slug: "other" }] }))).toEqual(["event_ids_unique"]);
    expect(failed(raw({ events: [event("future", "2026-11-28T22:00:00Z", null, { venue_name: null })] }))).toEqual(["events_have_existing_venue"]);
    expect(failed(raw({ sources: [] }))).toEqual(["source_links_reference_known_sources", "canonical_source_ids_known"]);
    expect(failed(raw({ events: [] }))).toContain("at_least_one_event");
  });
});

describe("runQaExport", () => {
  it("reads only inside a verified read-only transaction, proves the role, and always rolls back", async () => {
    const seen: string[] = [];
    const client = {
      async query(sql: string) {
        seen.push(sql);
        if (sql === "SHOW transaction_read_only") return { rows: [{ transaction_read_only: "on" }] };
        if (sql === GUARD_STATEMENTS[0]) {
          return { rows: [{ rolname: "report_ro", rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false, member_of: [], db_create: false, db_temp: false, db_owner: false, default_read_only: "on" }] };
        }
        if (sql.includes("can_select")) return { rows: QA_EXPORT_TABLES.map((t) => ({ ...t, can_select: true, rls: false, open_policy: false, restrictive_policy: false })) };
        if (sql === EVENTS_COUNT_SQL) return { rows: [{ n: 1 }] };
        if (sql === EVENTS_SQL) return { rows: [event("future", "2026-11-28T22:00:00Z", null)] };
        if (sql === SOURCES_SQL) return { rows: [{ id: "src-1", source_name: "Venue", source_type: "venue", active: true }] };
        return { rows: [] };
      },
    };
    const { snapshot, role } = await runQaExport(client, NOW);
    expect(role).toBe("report_ro");
    expect(snapshot.counts.events).toBe(1);
    expect(seen[0]).toBe(BEGIN_SQL);
    expect(seen[1]).toBe("SHOW transaction_read_only");
    expect(seen[2]).toBe(TIMEOUT_SQL);
    expect(seen.indexOf(EVENTS_SQL)).toBeGreaterThan(seen.indexOf(GUARD_STATEMENTS[0]));
    expect(seen.at(-1)).toBe("ROLLBACK");
  });

  it("refuses before any data query when the transaction is not read-only, and still rolls back", async () => {
    const seen: string[] = [];
    const client = {
      async query(sql: string) {
        seen.push(sql);
        return sql === "SHOW transaction_read_only" ? { rows: [{ transaction_read_only: "off" }] } : { rows: [] };
      },
    };
    await expect(runQaExport(client, NOW)).rejects.toThrow(/transaction_read_only/);
    expect(seen).not.toContain(EVENTS_SQL);
    expect(seen.at(-1)).toBe("ROLLBACK");
  });

  it("contains SELECT statements only and reads only tables the report role is granted", () => {
    for (const sql of [EVENTS_SQL, EVENTS_COUNT_SQL, LINKS_SQL, CHANGES_SQL, SOURCES_SQL]) {
      expect(sql.trimStart()).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT)\b/i);
    }
    expect(BEGIN_SQL).toMatch(/READ ONLY/);
    for (const t of QA_EXPORT_TABLES) expect(SHARED_REPORT_RO_TABLES).toContain(`${t.schema}.${t.name}`);
  });
});

describe("qa-export-readonly.yml", () => {
  const yaml = readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "qa-export-readonly.yml"), "utf-8");

  it("starts manually or on the 10-minute crons only, covering 01:07-04:57 Copenhagen time in CET and CEST", () => {
    expect(yaml).toMatch(/\non:\n {2}workflow_dispatch:\n {2}schedule:\n(?: {4}#.*\n)* {4}- cron: "7-59\/10 23 \* \* \*"\n {4}- cron: "7-59\/10 0-3 \* \* \*"\n\n/);
    expect(yaml).not.toMatch(/\n {2}(push|pull_request|pull_request_target|workflow_run|repository_dispatch):/);
    expect(yaml).toContain("if: needs.clock.outputs.run == 'true'");
    // Firing times (UTC hours 23 and 0-3 at :07..:57) in CET and CEST: 01:07-04:57 local is always covered, and the
    // only firings the 01:00-05:15 gate lets through after 05:00 are summer 05:07 (03:07 UTC); 05:17+ never export.
    const fires = [23, 0, 1, 2, 3].flatMap((h) => [7, 17, 27, 37, 47, 57].map((m) => h * 60 + m));
    for (const offset of [60, 120]) {
      const local = fires.map((t) => (t + offset) % 1440);
      for (let t = 67; t <= 4 * 60 + 57; t += 10) expect(local).toContain(t);
      const allowed = local.filter((t) => t >= 60 && t < 5 * 60 + 15);
      expect(allowed.filter((t) => t >= 5 * 60)).toEqual(offset === 120 ? [5 * 60 + 7] : []);
    }
  });

  describe("clock gate (the step's real script, gh stubbed)", () => {
    const start = yaml.indexOf("      - name: Allow one scheduled export per Copenhagen day");
    const body = yaml.slice(yaml.indexOf("run: |\n", start) + "run: |\n".length, yaml.indexOf("\n\n  export:", start));
    const script = body.split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
    const dir = mkdtempSync(path.join(tmpdir(), "qa-clock-"));
    writeFileSync(path.join(dir, "gh"), '#!/bin/sh\nprintf "%s\\n" "$GH_STUB_LAST"\n', { mode: 0o755 });
    function gate(event: string, now: string, last: string): string {
      const out = path.join(dir, "out");
      writeFileSync(out, "");
      execFileSync("bash", ["-e", "-c", script], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, EVENT_NAME: event, QA_CLOCK_NOW: now, GH_STUB_LAST: last, GITHUB_OUTPUT: out, QA_DATA_REPO: "o/r" },
        stdio: "pipe",
      });
      return readFileSync(out, "utf8").trim();
    }
    it.each([
      ["manual start always runs, even after 05:15 with today's export", "workflow_dispatch", "2026-11-25T10:00:00Z", "2026-11-25T03:00:00Z", "run=true"],
      ["winter 04:57, no export yet today", "schedule", "2026-11-26T03:57:00Z", "2026-11-25T11:12:00Z", "run=true"],
      ["winter 03:07, already exported today at 02:17", "schedule", "2026-11-26T02:07:00Z", "2026-11-26T01:17:00Z", "run=false"],
      ["yesterday 23:30 Copenhagen does not count as today", "schedule", "2026-11-26T00:07:00Z", "2026-11-25T22:30:00Z", "run=true"],
      ["winter 00:57 is before the window", "schedule", "2026-11-25T23:57:00Z", "", "run=false"],
      ["delayed run at 05:14 still exports", "schedule", "2026-11-26T04:14:00Z", "2026-11-25T03:00:00Z", "run=true"],
      ["delayed run at 05:15 never starts", "schedule", "2026-11-26T04:15:00Z", "2026-11-25T03:00:00Z", "run=false"],
      ["summer 01:07 CEST (23:07 UTC the day before)", "schedule", "2026-06-14T23:07:00Z", "2026-06-14T01:00:00Z", "run=true"],
      ["DST switch day (CET→CEST 29 Mar), 04:07 CEST", "schedule", "2026-03-29T02:07:00Z", "2026-03-28T02:00:00Z", "run=true"],
      ["first ever export (no snapshot commit)", "schedule", "2026-11-26T02:07:00Z", "", "run=true"],
    ])("%s", (_name, event, now, last, expected) => {
      expect(gate(event, now, last)).toBe(expected);
    });
  });

  it("refuses to touch a register last changed by anyone but this workflow, before updating it", () => {
    const guard = yaml.indexOf("Refuse unless qa-status.json was last written by this workflow");
    expect(guard).toBeGreaterThan(yaml.indexOf("Checkout private QA data repository"));
    expect(guard).toBeLessThan(yaml.indexOf("Update QA control register"));
    expect(yaml).toContain('if [ "$author" != "$BOT_EMAIL" ]; then');
    expect(yaml).toContain("node --import tsx src/lib/qaStatusCli.ts");
    expect(yaml).not.toMatch(/push[^\n]*--force|push -f\b/);
  });

  it("never uses the read-write DATABASE_URL and keeps this repository's token read-only", () => {
    expect(yaml).not.toMatch(/secrets\.DATABASE_URL\b(?!_REPORT_RO)/);
    expect(yaml).toMatch(/\npermissions:\n {2}contents: read\n/);
    expect(yaml).toContain("persist-credentials: false");
  });

  it("never publishes the snapshot as an artifact, and refuses a non-private target", () => {
    expect(yaml).not.toContain("upload-artifact");
    expect(yaml).toContain('if [ "$visibility" != "private" ]; then');
    expect(yaml.indexOf("Refuse unless the target repository is private")).toBeLessThan(yaml.indexOf("Export QA snapshot (read-only)"));
    expect(yaml).toContain('node --import tsx src/db/exportQaSnapshot.ts --out="$RUNNER_TEMP/qa-snapshot.json"');
  });
});
