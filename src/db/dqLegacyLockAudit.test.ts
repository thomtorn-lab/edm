import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { DQ_LEGACY_LOCK_SQL, runDqLegacyLockAudit } from "./dqLegacyLockAudit";
import { beginReadOnlyTransaction } from "./readOnlyTransaction";

describe("dq-legacy-lock-audit SQL", () => {
  it("is a single SELECT on pending rows that reads no content columns", () => {
    const sql = DQ_LEGACY_LOCK_SQL.trim().replace(/'[^']*'/g, "''");
    expect(sql.toUpperCase().startsWith("SELECT")).toBe(true);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|FOR UPDATE|FOR SHARE)\b/i);
    expect(sql).not.toContain(";");
    for (const column of ["probable_title", "description", "detected_lineup", "probable_official_event_url", "probable_ticket_url", "source_url", "probable_venue_name"]) {
      expect(DQ_LEGACY_LOCK_SQL).not.toContain(column);
    }
    expect(DQ_LEGACY_LOCK_SQL).toContain("dq.status = 'pending'");
  });

  it("is wired into inspect-source and offered by the workflow", () => {
    expect(readFileSync(path.join(__dirname, "inspectSource.ts"), "utf8")).toContain('"dq-legacy-lock-audit": modeDqLegacyLockAudit');
    expect(readFileSync(path.join(__dirname, "../../.github/workflows/inspect-source.yml"), "utf8")).toContain("- dq-legacy-lock-audit");
  });
});

const TEST_DB = process.env.AUDIT_TEST_DATABASE_URL;
describe.skipIf(!TEST_DB)("dq-legacy-lock-audit against a real Postgres (AUDIT_TEST_DATABASE_URL)", () => {
  it("counts the pattern from real rows inside a read-only transaction", async () => {
    const client = new Client({ connectionString: TEST_DB });
    const schema = `dq_lock_test_${Date.now()}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE discovery_queue (id text PRIMARY KEY, status text NOT NULL, source_id text, overridden_fields text[] NOT NULL DEFAULT '{}',
        probable_start timestamptz, last_seen_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), probable_title text)`);
      const full = "{probableTitle,description,probableVenueName,probableSubVenue,detectedLineup,predictedGenre,predictedSecondaryGenre,probableOfficialEventUrl,probableTicketUrl,probableResidentAdvisorUrl,probableFree,probableStart,probableEnd}";
      await client.query(`INSERT INTO discovery_queue (id, status, source_id, overridden_fields, probable_start, last_seen_at, created_at) VALUES
        ('dq-a', 'pending', 'src-pumpehuset', '${full}', now() + interval '5 days', now(), '2026-10-01'),
        ('dq-b', 'pending', NULL, '${full}', now() - interval '5 days', NULL, '2026-10-01'),
        ('dq-c', 'published', 'src-pumpehuset', '${full}', now() + interval '5 days', now(), '2026-10-01'),
        ('dq-d', 'pending', 'src-kultunaut', '{detectedLineup}', now() + interval '5 days', now(), '2026-10-01')`);
      await beginReadOnlyTransaction(client);
      const lines: string[] = [];
      const report = await runDqLegacyLockAudit(client, new Date(), (l) => lines.push(l));
      await expect(client.query(`CREATE TABLE should_fail (x int)`)).rejects.toThrow(/read-only/);
      await client.query("ROLLBACK");
      expect(report.pendingRows).toBe(3);
      expect(report.fullPattern).toMatchObject({ rows: 2, publishable: 1, publishableAndCurrent: 1, withFullFormMarker: 2 });
      expect(report.partialPattern.rows).toBe(1);
      expect(lines.join("\n")).toContain("no figure here distinguishes a deliberate correction");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
