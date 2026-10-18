import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { mapOverrideScopeRow, OVERRIDE_SCOPE_SQL, runOverrideScopeAudit } from "./overrideScopeAudit";
import { beginReadOnlyTransaction } from "./readOnlyTransaction";

describe("override-scope-audit SQL", () => {
  it("is a single SELECT with no write, DDL or locking clause", () => {
    // String literals (e.g. change_type = 'create') are data, not statements.
    const sql = OVERRIDE_SCOPE_SQL.trim().replace(/'[^']*'/g, "''");
    expect(sql.toUpperCase().startsWith("SELECT")).toBe(true);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|FOR UPDATE|FOR SHARE)\b/i);
    expect(sql).not.toContain(";");
  });

  it("selects no event content: no titles, descriptions, URLs, artists or change-log notes", () => {
    for (const column of ["title", "description", "artists", "official_event_url", "ticket_url", "resident_advisor_url", "facebook_url", "note", "slug"]) {
      expect(OVERRIDE_SCOPE_SQL).not.toMatch(new RegExp(`\\b[a-z]\\.${column}\\b`));
    }
  });

  it("covers upcoming published events only", () => {
    expect(OVERRIDE_SCOPE_SQL).toContain("e.published = true AND e.start_datetime >= now()");
  });

  it("is wired into inspect-source as a read-only mode and offered by the workflow", () => {
    const inspect = readFileSync(path.join(__dirname, "inspectSource.ts"), "utf8");
    expect(inspect).toContain('"override-scope-audit": modeOverrideScopeAudit');
    const workflow = readFileSync(path.join(__dirname, "../../.github/workflows/inspect-source.yml"), "utf8");
    expect(workflow).toContain("- override-scope-audit");
  });
});

describe("mapOverrideScopeRow", () => {
  it("maps nulls and array columns defensively", () => {
    expect(
      mapOverrideScopeRow({
        id: "e-1",
        canonical_source_id: null,
        overridden_fields: ["title", null],
        linked_source_ids: null,
        recently_syncing_source_ids: ["src-kultunaut"],
        created_by: null,
        admin_logged_fields: [],
      }),
    ).toEqual({
      id: "e-1",
      canonicalSourceId: null,
      overriddenFields: ["title"],
      linkedSourceIds: [],
      recentlySyncingSourceIds: ["src-kultunaut"],
      createdBy: null,
      adminLoggedFields: [],
    });
  });
});

/**
 * Optional real-Postgres check, skipped unless AUDIT_TEST_DATABASE_URL points
 * at a DISPOSABLE database (same convention as auditEventsWindow.test.ts). It
 * creates a throwaway schema with regular tables, runs the audit inside a
 * genuine read-only transaction, checks the figures, and drops the schema.
 */
const TEST_DB = process.env.AUDIT_TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("override-scope-audit against a real Postgres (AUDIT_TEST_DATABASE_URL)", () => {
  it("reports locks, sources, creators and documentation status from real tables inside a read-only transaction", async () => {
    const client = new Client({ connectionString: TEST_DB });
    const schema = `override_scope_test_${Date.now()}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE events (
        id text PRIMARY KEY, start_datetime timestamptz NOT NULL, published boolean NOT NULL DEFAULT true,
        canonical_source_id text, overridden_fields text[] NOT NULL DEFAULT '{}')`);
      await client.query(`CREATE TABLE source_event_links (event_id text NOT NULL, source_id text NOT NULL, source_url text NOT NULL, role text NOT NULL)`);
      await client.query(`CREATE TABLE event_change_log (
        id text PRIMARY KEY, event_id text NOT NULL, changed_by text NOT NULL, change_type text NOT NULL,
        fields_changed text[] NOT NULL DEFAULT '{}', note text, created_at timestamptz NOT NULL DEFAULT now())`);

      const future = "now() + interval '3 days'";
      await client.query(`INSERT INTO events VALUES
        ('e-admin', ${future}, true, NULL, '{title,description,artists,startDatetime,venueId,primaryGenre,endDatetime}'),
        ('e-edited', ${future}, true, 'src-pumpehuset', '{artists}'),
        ('e-free', ${future}, true, 'src-pumpehuset', '{}'),
        ('e-past', now() - interval '3 days', true, NULL, '{title}'),
        ('e-hidden', ${future}, false, NULL, '{title}')`);
      await client.query(`INSERT INTO source_event_links VALUES
        ('e-edited', 'src-pumpehuset', 'https://p.example/1', 'official'),
        ('e-free', 'src-pumpehuset', 'https://p.example/2', 'official')`);
      await client.query(`INSERT INTO event_change_log (id, event_id, changed_by, change_type, fields_changed) VALUES
        ('l1', 'e-admin', 'admin', 'create', '{title,description}'),
        ('l2', 'e-edited', 'src-pumpehuset', 'create', '{title}'),
        ('l3', 'e-edited', 'admin', 'update', '{artists}'),
        ('l4', 'e-edited', 'src-kultunaut', 'sync', '{}'),
        ('l5', 'e-admin', 'src-kultunaut', 'sync', '{}'),
        ('l6', 'e-admin', 'admin', 'release_override', '{title}')`);

      await beginReadOnlyTransaction(client);
      const lines: string[] = [];
      const report = await runOverrideScopeAudit(client, (l) => lines.push(l));
      await expect(client.query(`CREATE TABLE should_fail (x int)`)).rejects.toThrow(/read-only/);
      await client.query("ROLLBACK");

      expect(report.upcomingPublishedEvents).toBe(3);
      expect(report.withAnyLock.eventIds).toEqual(["e-admin", "e-edited"]);
      expect(report.allCoreContentLocked.eventIds).toEqual(["e-admin"]);
      expect(report.lockCountsByField.find((f) => f.field === "artists")).toMatchObject({ locked: 2, documentedByAdminEdit: 1, noLoggedAdminEdit: 1 });
      // a release row never documents a lock
      expect(report.lockCountsByField.find((f) => f.field === "title")).toMatchObject({ locked: 1, documentedByAdminEdit: 0, noLoggedAdminEdit: 1 });
      expect(report.multipleSources).toMatchObject({ count: 1, eventIds: ["e-edited"], withAnyLock: 1 });
      expect(report.lockedEventsByCreator).toEqual([
        { createdBy: "admin", events: 1 },
        { createdBy: "src-pumpehuset", events: 1 },
      ]);
      expect(lines.join("\n")).toContain("With at least one lock: 2");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
