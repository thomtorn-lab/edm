import { describe, expect, it, vi } from "vitest";
import { buildQaSnapshot } from "@/db/exportQaSnapshot";
import { emptyQaStatus, QA_CATEGORIES } from "./qaStatus";
import { snapshotInputs, updateRegister } from "./qaStatusCli";

vi.mock("@/db/client", () => ({ db: {} }));

function snapshotAt(now: Date, title = "Night") {
  const row = {
    id: "e1", slug: "e1", title, description: "About", artists: ["A"], start_datetime: new Date("2026-12-05T22:00:00Z"), end_datetime: null,
    timezone: "Europe/Copenhagen", venue_id: "v", venue_name: "V", venue_slug: "v", sub_venue: null, primary_genre: "techno",
    subgenres: ["techno"], genre_confidence: "high", official_event_url: "https://o.example", ticket_url: null, facebook_url: null,
    resident_advisor_url: null, other_source_urls: [], sold_out: false, cancelled: false, postponed: false, date_changed: false,
    time_changed: false, canonical_source_id: "s", manual_override: false, overridden_fields: [], created_at: now, updated_at: now,
    last_source_check: null, last_changed: null,
  };
  return buildQaSnapshot({ events: [row], prefilterCount: 1, links: [], changes: [], sources: [{ id: "s", source_name: "S", source_type: "venue", active: true }] }, now);
}

describe("qaStatusCli updateRegister (snapshot → register end to end)", () => {
  const d1 = new Date("2026-11-25T03:17:00.000Z");
  const d2 = new Date("2026-11-26T03:17:00.000Z");

  it("creates five checks per event from the real export format", () => {
    const s = snapshotAt(d1);
    expect(snapshotInputs(s)).toHaveLength(QA_CATEGORIES.length);
    const reg = updateRegister(emptyQaStatus(), s, [], d1);
    expect(reg.coverage?.source_facts.pending).toBe(1);
    expect(reg.snapshot_generated_at).toBe(d1.toISOString());
  });

  it("applies a result for yesterday's snapshot, then reopens what today's snapshot changed", () => {
    const s1 = snapshotAt(d1);
    const reg1 = updateRegister(emptyQaStatus(), s1, [], d1);
    const fp = s1.events[0].category_fingerprints;
    const result = {
      name: "qa-results/2026-11-25T05-30-00Z.json",
      content: JSON.stringify({
        schema_version: 1, type: "qa_results", snapshot_generated_at: s1.generated_at, completed_at: "2026-11-25T05:30:00.000Z",
        results: [
          { event_id: "e1", category: "about_language", fingerprint: fp.about_language, status: "completed", checked_at: "2026-11-25T05:20:00.000Z", evidence: ["https://www.electroniccph.com/events/e1"] },
          { event_id: "e1", category: "links", fingerprint: fp.links, status: "completed", checked_at: "2026-11-25T05:21:00.000Z", evidence: ["https://o.example"] },
        ],
        discovery: { status: "not_run", summary: "" },
        production_technical: { status: "not_run", summary: "" },
      }),
    };
    const reg2 = updateRegister(reg1, snapshotAt(d2, "Night (new title)"), [result], d2);
    const status = (c: string) => reg2.checks.find((x) => x.category === c)!.status;
    expect(status("links")).toBe("completed"); // title is not part of the links fingerprint
    expect(status("about_language")).toBe("pending"); // title changed → reopened
    expect(reg2.runs[0].accepted).toBe(2);
  });

  it("refuses a snapshot that failed validation or has the old format", () => {
    const s = snapshotAt(d1);
    expect(() => updateRegister(emptyQaStatus(), { ...s, validation: { ...s.validation, passed: false } }, [], d1)).toThrow(/validation/);
    expect(() => updateRegister(emptyQaStatus(), { ...s, schema_version: 2 }, [], d1)).toThrow(/schema_version/);
  });
});
