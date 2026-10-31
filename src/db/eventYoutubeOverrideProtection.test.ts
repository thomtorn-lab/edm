import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Manual per-event video choices (event_youtube_preview_overrides) must never
 * be overwritten by syncs, enrichment or automated backfills (2026-10-24).
 * The guarantee is structural: only the modules listed here can reach the
 * table at all, and every write lives in src/db/eventYoutubeOverrides.ts,
 * whose callers are the admin API route and the admin workflow CLI. A new
 * file that touches the table — e.g. a sync or matcher starting to write
 * it — fails this test and has to be added here deliberately.
 */

const ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(ROOT).map((path) => ({ path: relative(ROOT, path).split("\\").join("/"), text: readFileSync(path, "utf8") }));

describe("event_youtube_preview_overrides — who can touch it", () => {
  it("only the schema, the override module, and the read-only display query reference the table in code", () => {
    // The drizzle table object, or the table name as a quoted SQL/string literal (comments naming it don't count).
    const touching = files.filter((f) => /eventYoutubePreviewOverrides|["'`]event_youtube_preview_overrides/.test(f.text)).map((f) => f.path);
    expect(touching.sort()).toEqual([
      "db/eventYoutubeOverrides.ts",
      // Read-only YouTube preview risk report (#141): SELECT inside a verified READ ONLY transaction, as the read-only report_ro role.
      "db/reportReadOnlyGuard.ts",
      "db/schema.ts",
      "db/youtubePreviewRiskReport.ts",
      "lib/queries.ts",
    ]);
  });

  it("the read-only risk report only names the table in SELECT / catalog lookups — never writes it", () => {
    for (const path of ["db/youtubePreviewRiskReport.ts", "db/reportReadOnlyGuard.ts"]) {
      const text = files.find((f) => f.path === path)!.text;
      expect(text).not.toMatch(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|DROP\s+TABLE)\s+(public\.)?event_youtube_preview_overrides/i);
      expect(text).not.toMatch(/\.(insert|update|delete)\(\s*eventYoutubePreviewOverrides/);
      expect(text).not.toMatch(/from "(\.\/|@\/db\/)eventYoutubeOverrides"/);
    }
  });

  it("the display query only selects from it — never inserts, updates or deletes", () => {
    const queries = files.find((f) => f.path === "lib/queries.ts")!.text;
    expect(queries).not.toMatch(/\.(insert|update|delete)\(\s*eventYoutubePreviewOverrides/);
  });

  it("only the admin route's service and the admin workflow CLI use the override writes", () => {
    const importers = files.filter((f) => /from "(\.\/|@\/db\/)eventYoutubeOverrides"/.test(f.text)).map((f) => f.path);
    expect(importers.sort()).toEqual(["db/eventYoutubeAdmin.ts", "db/eventYoutubeOverride.ts"]);
    const adminImporters = files.filter((f) => /from "(\.\/|@\/db\/)eventYoutubeAdmin"/.test(f.text)).map((f) => f.path);
    expect(adminImporters.sort()).toEqual(["app/api/admin/events/[id]/youtube/route.ts", "components/admin/EventYoutubePanel.tsx"]);
  });

  it("the admin panel imports only types from the server module (nothing server-side ships to the browser)", () => {
    const panel = files.find((f) => f.path === "components/admin/EventYoutubePanel.tsx")!.text;
    expect(panel).toMatch(/import type \{[^}]*\} from "@\/db\/eventYoutubeAdmin"/);
  });
});
