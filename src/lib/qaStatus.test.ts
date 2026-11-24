import { describe, expect, it } from "vitest";
import {
  type CategoryFingerprintInput,
  applyQaResults,
  categoryFingerprints,
  emptyQaStatus,
  fingerprint,
  QA_CATEGORIES,
  reconcileQaStatus,
  validateQaStatus,
  type QaInput,
  type QaStatus,
} from "./qaStatus";

const T0 = "2026-11-25T03:17:00.000Z";
const T1 = "2026-11-26T03:17:00.000Z";
const inputs = (id: string, fp = "a"): QaInput[] => QA_CATEGORIES.map((category) => ({ subject_id: id, category, source_fingerprint: `${fp}-${category}` }));
const check = (s: QaStatus, id: string, category: string) => s.checks.find((c) => c.subject_id === id && c.category === category)!;

function resultFile(name: string, results: unknown[], extra: Record<string, unknown> = {}) {
  return {
    name,
    content: JSON.stringify({
      schema_version: 1, type: "qa_results", run_id: "r1", snapshot_generated_at: T0, completed_at: "2026-11-25T05:30:00.000Z",
      results,
      discovery: { status: "completed", summary: "searched RA and venues", evidence: ["https://ra.co/events/dk/copenhagen"], issues: [] },
      production_technical: { status: "completed", summary: "site ok", evidence: ["https://www.electroniccph.com/"], issues: [] },
      ...extra,
    }),
  };
}
const ok = (over: Record<string, unknown> = {}) => ({
  event_id: "e1", category: "links", fingerprint: "a-links", status: "completed", method: "link_check",
  checked_at: "2026-11-25T05:10:00.000Z", evidence: ["https://venue.example/e1"], issues: [], ...over,
});
const NOW = new Date("2026-11-26T03:18:00.000Z");
const base = () => reconcileQaStatus(emptyQaStatus(), inputs("e1"), T0);

describe("QA status continuity (reused from the tested ledger)", () => {
  it("adds five pending checks for a new event and keeps completed ones on the next run", () => {
    const first = base();
    expect(first.checks.map((c) => c.category)).toEqual([...QA_CATEGORIES]);
    expect(first.checks.every((c) => c.status === "pending" && c.current)).toBe(true);
    const done = applyQaResults(first, [resultFile("qa-results/1.json", [ok()])], NOW);
    const second = reconcileQaStatus(done, inputs("e1"), T1);
    expect(check(second, "e1", "links")).toMatchObject({ status: "completed", evidence: ["https://venue.example/e1"], checked_at: "2026-11-25T05:10:00.000Z" });
    expect(second.generation).toBe(2);
  });

  it("reopens only the category whose fingerprint changed, keeping issue history", () => {
    const done = applyQaResults(base(), [resultFile("qa-results/1.json", [
      ok({ status: "issue", issues: [{ id: "i1", summary: "ticket link 404" }] }),
      ok({ category: "source_facts", fingerprint: "a-source_facts" }),
    ])], NOW);
    const changed = inputs("e1").map((i) => (i.category === "links" ? { ...i, source_fingerprint: "b-links" } : i));
    const next = reconcileQaStatus(done, changed, T1);
    expect(check(next, "e1", "links")).toMatchObject({ status: "pending", reported_issue_ids: ["i1"], evidence: [] });
    expect(check(next, "e1", "source_facts").status).toBe("completed");
    expect(next.reported_issues.map((i) => i.id)).toEqual(["i1"]);
  });

  it("reopens an unchanged check at its next_check_at deadline, not before", () => {
    const done = applyQaResults(base(), [resultFile("qa-results/1.json", [ok({ next_check_at: "2026-11-27T00:00:00.000Z" })])], NOW);
    expect(check(reconcileQaStatus(done, inputs("e1"), T1), "e1", "links").status).toBe("completed");
    expect(check(reconcileQaStatus(done, inputs("e1"), "2026-11-27T03:17:00.000Z"), "e1", "links").status).toBe("pending");
  });

  it("keeps past events as history (current: false) and counts coverage for current ones only", () => {
    const next = reconcileQaStatus(base(), inputs("e2"), T1);
    expect(check(next, "e1", "links").current).toBe(false);
    expect(next.coverage?.links).toEqual({ pending: 1, completed: 0, issue: 0, blocked: 0 });
  });

  it("rejects stale snapshots, duplicate checks and duplicate incoming checks", () => {
    expect(() => reconcileQaStatus(base(), [], "2026-11-24T03:17:00.000Z")).toThrow(/Stale/);
    const b = base();
    expect(() => validateQaStatus({ ...b, checks: [b.checks[0], b.checks[0]] })).toThrow(/Duplicate/);
    expect(() => reconcileQaStatus(emptyQaStatus(), [...inputs("e1"), ...inputs("e1")], T0)).toThrow(/Duplicate/);
  });

  it("refuses a register where a check is completed without date and evidence", () => {
    const b = base();
    b.checks[0].status = "completed";
    expect(() => validateQaStatus(b)).toThrow(/without a check date and evidence/);
  });

  it("fingerprint is independent of object key order", () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });
});

describe("applyQaResults", () => {
  const rejected = (s: QaStatus) => s.runs.at(-1)!.rejected.map((r) => r.reason);

  it("rejects wrong fingerprint, unknown event/category and missing evidence without changing the check", () => {
    const s = applyQaResults(base(), [resultFile("qa-results/1.json", [
      ok({ fingerprint: "old" }),
      ok({ event_id: "nope" }),
      ok({ category: "discovery" }),
      ok({ evidence: [] }),
      ok({ evidence: ["looked at it"] }),
    ])], NOW);
    expect(check(s, "e1", "links").status).toBe("pending");
    expect(rejected(s)).toEqual([
      "fingerprint does not match the checked content",
      "unknown event_id/category",
      "unknown event_id/category",
      "completed without an evidence URL",
      "completed without an evidence URL",
    ]);
  });

  it("completes music_genre only with independent verification and an external source", () => {
    const g = (over: Record<string, unknown>) => ok({ category: "music_genre", fingerprint: "a-music_genre", ...over });
    const structural = applyQaResults(base(), [resultFile("qa-results/1.json", [g({ method: "structural", evidence: ["https://www.electroniccph.com/events/x"] })])], NOW);
    expect(check(structural, "e1", "music_genre")).toMatchObject({ status: "pending", structural_checked_at: "2026-11-25T05:10:00.000Z" });

    const siteOnly = applyQaResults(base(), [resultFile("qa-results/1.json", [g({ method: "independent_music_verification", evidence: ["https://www.electroniccph.com/events/x"] })])], NOW);
    expect(check(siteOnly, "e1", "music_genre").status).toBe("pending");
    expect(rejected(siteOnly)).toEqual(["music_genre needs an external (non-electroniccph.com) source"]);

    const noMethod = applyQaResults(base(), [resultFile("qa-results/1.json", [g({ method: "link_check" })])], NOW);
    expect(check(noMethod, "e1", "music_genre").status).toBe("pending");

    const real = applyQaResults(base(), [resultFile("qa-results/1.json", [g({ method: "independent_music_verification", evidence: ["https://www.discogs.com/artist/1"] })])], NOW);
    expect(check(real, "e1", "music_genre")).toMatchObject({ status: "completed", method: "independent_music_verification" });
  });

  it("rejects a whole file for another snapshot or a stale QA run, and processes each file once", () => {
    const other = applyQaResults(base(), [resultFile("qa-results/1.json", [ok()], { snapshot_generated_at: "2026-11-24T03:17:00.000Z" })], NOW);
    expect(check(other, "e1", "links").status).toBe("pending");
    expect(rejected(other)[0]).toMatch(/register is at/);

    const stale = applyQaResults(base(), [resultFile("qa-results/1.json", [ok()], { completed_at: "2026-11-26T09:00:00.000Z" })], new Date("2026-11-26T10:00:00Z"));
    expect(rejected(stale)).toEqual(["snapshot was stale when the QA ran"]);

    const once = applyQaResults(base(), [resultFile("qa-results/1.json", [ok()])], NOW);
    const again = applyQaResults(once, [resultFile("qa-results/1.json", [ok({ status: "blocked", evidence: ["x"] })])], NOW);
    expect(again.runs).toHaveLength(1);
    expect(check(again, "e1", "links").status).toBe("completed");
  });

  it("records invalid JSON, ignores the write-test file, and requires discovery and production_technical", () => {
    const s = applyQaResults(base(), [
      { name: "qa-results/bad.json", content: "{" },
      { name: "qa-results/test.json", content: JSON.stringify({ schema_version: 1, type: "write_test" }) },
      resultFile("qa-results/run.json", [], { discovery: undefined }),
    ], NOW);
    expect(s.runs.map((r) => r.result_file)).toEqual(["qa-results/bad.json", "qa-results/run.json"]);
    expect(s.runs[0].rejected[0].reason).toBe("invalid JSON");
    expect(s.runs[1].rejected.map((r) => r.reason)).toEqual(["missing: discovery must be reported each run"]);
    expect(s.runs[1].production_technical?.status).toBe("completed");
    expect(s.processed_result_files).toContain("qa-results/test.json");
  });

  it("records run-level issues and resolves earlier event issues", () => {
    const first = applyQaResults(base(), [resultFile("qa-results/1.json", [ok({ status: "issue", issues: [{ id: "i1", summary: "404" }] })], {
      discovery: { status: "issue", summary: "missing event", evidence: ["https://ra.co/x"], issues: [{ id: "d1", summary: "RA event not listed" }] },
    })], NOW);
    expect(first.reported_issues.map((i) => [i.id, i.category])).toEqual([["d1", "discovery"], ["i1", "links"]]);
    const second = applyQaResults(first, [resultFile("qa-results/2.json", [ok({ resolved_issue_ids: ["i1"] })])], NOW);
    expect(second.reported_issues.find((i) => i.id === "i1")?.resolved_at).toBe("2026-11-25T05:10:00.000Z");
    expect(check(second, "e1", "links")).toMatchObject({ status: "completed", reported_issue_ids: ["i1"] });
  });

  it("issue needs an issue, blocked needs a reason", () => {
    const s = applyQaResults(base(), [resultFile("qa-results/1.json", [ok({ status: "issue" }), ok({ status: "blocked", evidence: [] })])], NOW);
    expect(rejected(s)).toEqual(["status issue without an issue", "blocked without a reason"]);
  });
});

describe("categoryFingerprints", () => {
  const e: CategoryFingerprintInput = {
    title: "T", description: "About", artists: ["A"], start_datetime: T0, end_datetime: null, venue_id: "v", sub_venue: null,
    primary_genre: "techno", subgenres: ["techno"], genre_confidence: "high", official_event_url: "https://o", ticket_url: null,
    facebook_url: null, resident_advisor_url: null, other_source_urls: [], sold_out: false, cancelled: false, postponed: false,
    source_links: [{ source_id: "s", source_url: "https://o", role: "official" }],
  };
  const diff = (over: Partial<CategoryFingerprintInput>) => {
    const a = categoryFingerprints(e), b = categoryFingerprints({ ...e, ...over });
    return QA_CATEGORIES.filter((c) => a[c] !== b[c]);
  };
  it("changes only the categories the changed field belongs to", () => {
    expect(diff({ description: "Om" })).toEqual(["about_language"]);
    expect(diff({ subgenres: ["house"] })).toEqual(["music_genre"]);
    expect(diff({ ticket_url: "https://t" })).toEqual(["links", "duplicates"]);
    expect(diff({ cancelled: true })).toEqual(["source_facts"]);
    expect(diff({ artists: ["B"] })).toEqual(["source_facts", "music_genre", "duplicates"]);
  });
});
