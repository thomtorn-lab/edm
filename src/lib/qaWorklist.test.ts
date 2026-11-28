import { describe, expect, it, vi } from "vitest";
import { buildQaSnapshot } from "@/db/exportQaSnapshot";
import { applyQaResults, emptyQaStatus, QA_CATEGORIES } from "./qaStatus";
import { updateRegister } from "./qaStatusCli";
import { buildQaWorklist, eventFindings, serializeQaWorklist } from "./qaWorklist";

vi.mock("@/db/client", () => ({ db: {} }));

const NOW = new Date("2026-11-28T01:38:00.000Z");

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id, slug: id, title: `Night ${id}`, description: "An English description of a club night with techno DJs.", artists: [`Alpha ${id}`, `Beta ${id}`],
    start_datetime: new Date("2026-12-10T22:00:00Z"), end_datetime: null, timezone: "Europe/Copenhagen",
    venue_id: "v-1", venue_name: "Venue One", venue_slug: "venue-one", sub_venue: null,
    primary_genre: "techno", subgenres: ["techno"], genre_confidence: "high",
    official_event_url: `https://venue.example/${id}`, ticket_url: `https://tickets.example/${id}`, facebook_url: null, resident_advisor_url: null, other_source_urls: [],
    sold_out: false, cancelled: false, postponed: false, date_changed: false, time_changed: false,
    canonical_source_id: "src-v", manual_override: false, overridden_fields: [],
    created_at: new Date("2026-11-01T00:00:00Z"), updated_at: NOW, last_source_check: NOW, last_changed: NOW,
    ...over,
  };
}

function setup(rows: ReturnType<typeof row>[], links: Record<string, unknown>[] = []) {
  const snapshot = buildQaSnapshot({ events: rows, prefilterCount: rows.length, links, changes: [], sources: [{ id: "src-v", source_name: "Venue One", source_type: "official-venue", active: true }] }, NOW);
  const status = updateRegister(emptyQaStatus(), snapshot, [], NOW);
  return { snapshot, status };
}

const codes = (r: ReturnType<typeof row>) => {
  const { snapshot } = setup([r]);
  return eventFindings(snapshot.events[0]).map((f) => `${f.kind}:${f.code}`);
};

describe("eventFindings: existing rules only, and what kind of statement each is", () => {
  it("a clean event has no findings", () => {
    expect(codes(row("e1"))).toEqual([]);
  });

  it("documented rule violations: genre rules, HvadErPå as Official, a repeated artist", () => {
    expect(codes(row("e1", { subgenres: ["techno", "house", "trance"] }))).toContain("rule_violation:genre_too_many");
    expect(codes(row("e1", { subgenres: ["electronic-other", "techno"] }))).toContain("rule_violation:genre_fallback_combined");
    expect(codes(row("e1", { official_event_url: "https://www.hvaderpaa.dk/da/event/x" }))).toContain("rule_violation:official_url_is_hvaderpaa");
    expect(codes(row("e1", { artists: ["Alpha", "ALPHA "] }))).toContain("rule_violation:lineup_duplicate_artist");
  });

  it("observations that are facts but not errors: TBA, no ABOUT, Official = Tickets, no Official URL, Danish ABOUT", () => {
    expect(codes(row("e1", { artists: ["Alpha", "TBA"] }))).toEqual(["observation:lineup_placeholder"]);
    expect(codes(row("e1", { description: null }))).toEqual(["observation:no_about_text"]);
    expect(codes(row("e1", { ticket_url: "https://venue.example/e1?utm_source=x" }))).toEqual(["observation:official_equals_ticket"]);
    expect(codes(row("e1", { official_event_url: null }))).toEqual(["observation:no_official_url"]);
    expect(codes(row("e1", { description: "Kom og dans med os hele natten, det bliver en fest og der er gratis entré før midnat for alle." }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^observation:about_(hidden_as|reads)_danish$/)]),
    );
  });
});

describe("buildQaWorklist", () => {
  it("lists every event with open checks, with the fingerprints the result file needs", () => {
    const { snapshot, status } = setup([row("e1"), row("e2")]);
    const w = buildQaWorklist(snapshot, status);
    expect(w.events.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    const e1 = w.events.find((e) => e.id === "e1")!;
    for (const c of QA_CATEGORIES) expect(e1.open_checks[c]).toBe(snapshot.events[0].category_fingerprints[c]);
    expect(e1).toMatchObject({ venue: { name: "Venue One" }, artists: ["Alpha e1", "Beta e1"], genres: ["techno"], links: { official_event_url: "https://venue.example/e1" } });
    expect(w.sources).toEqual({ "src-v": "Venue One" });
    expect(w.summary.pending_checks).toBe(10);
  });

  it("puts structural findings into the priority: a rule violation outranks an imminent event, which outranks a plain one", () => {
    const { snapshot, status } = setup([
      row("plain"),
      row("imminent", { start_datetime: new Date("2026-11-29T21:00:00Z") }),
      row("violation", { subgenres: ["techno", "house", "trance"] }),
      row("candidate-a", { title: "Same Night", artists: ["Gamma"], start_datetime: new Date("2026-12-12T22:00:00Z") }),
      row("candidate-b", { title: "Same Night", artists: ["Gamma"], start_datetime: new Date("2026-12-12T22:00:00Z"), official_event_url: "https://venue.example/candidate-a" }),
    ]);
    const w = buildQaWorklist(snapshot, status);
    const order = w.events.map((e) => e.id);
    expect(w.events.find((e) => e.id === "plain")!.findings).toEqual([]);
    expect(order[0]).toBe("violation");
    expect(order.indexOf("candidate-a")).toBeLessThan(order.indexOf("imminent"));
    expect(order.indexOf("imminent")).toBeLessThan(order.indexOf("plain"));
    expect(w.events.find((e) => e.id === "candidate-a")!.findings[0]).toMatchObject({ code: "possible_duplicate_event", kind: "candidate", categories: ["duplicates"] });
    expect(w.events.find((e) => e.id === "imminent")!.reasons).toContain("starts within 72 h with open checks");
  });

  it("gives no imminence boost to an event already in progress at export time, and marks new events", () => {
    const { snapshot, status } = setup([
      row("running", { start_datetime: new Date("2026-11-27T22:00:00Z") }),
      row("new", { created_at: new Date("2026-11-27T12:00:00Z") }),
    ]);
    const w = buildQaWorklist(snapshot, status);
    expect(w.events.find((e) => e.id === "running")!.reasons).toEqual(["in progress at export time (likely over before the QA runs)"]);
    expect(w.events.find((e) => e.id === "new")!.reasons).toContain("new event (added within 48 h)");
    expect(w.summary.new_events).toBe(1);
  });

  it("separates a reopened check from a structural-only genre check, and leaves completed checks out of the open list", () => {
    const d1 = new Date("2026-11-27T01:38:00Z");
    const s1 = buildQaSnapshot({ events: [row("e1")], prefilterCount: 1, links: [], changes: [], sources: [{ id: "src-v", source_name: "Venue One", source_type: "official-venue", active: true }] }, d1);
    const reg1 = updateRegister(emptyQaStatus(), s1, [], d1);
    const fp = s1.events[0].category_fingerprints;
    const result = {
      name: "qa-results/r.json",
      content: JSON.stringify({
        schema_version: 1, type: "qa_results", snapshot_generated_at: s1.generated_at, completed_at: "2026-11-27T05:30:00.000Z",
        results: [
          { event_id: "e1", category: "links", fingerprint: fp.links, status: "completed", checked_at: "2026-11-27T05:00:00.000Z", evidence: ["https://venue.example/e1"] },
          { event_id: "e1", category: "source_facts", fingerprint: fp.source_facts, status: "completed", checked_at: "2026-11-27T05:00:00.000Z", evidence: ["https://venue.example/e1"] },
          { event_id: "e1", category: "music_genre", fingerprint: fp.music_genre, status: "completed", method: "structural", checked_at: "2026-11-27T05:00:00.000Z", evidence: [] },
        ],
        discovery: { status: "not_run", summary: "" }, production_technical: { status: "not_run", summary: "" },
      }),
    };
    const withResults = applyQaResults(reg1, [result], new Date("2026-11-27T06:00:00Z"));
    // Next day the Official Event URL changed: only links reopens; source_facts stays completed.
    const { snapshot: s2 } = setup([row("e1", { official_event_url: "https://venue.example/e1-new" })]);
    const reg2 = updateRegister(withResults, s2, [], NOW);
    const e = buildQaWorklist(s2, reg2).events[0];
    expect(e.reopened).toEqual(["links"]);
    expect(e.completed_categories).toEqual(["source_facts"]);
    expect(e.open_checks).not.toHaveProperty("source_facts");
    expect(e.reasons).toEqual(expect.arrayContaining(["reopened after a change: links", "structural check only, independent verification outstanding: music_genre"]));
  });

  it("never changes the register it reads, and refuses a register from another export", () => {
    const { snapshot, status } = setup([row("e1")]);
    const before = JSON.stringify(status);
    buildQaWorklist(snapshot, status);
    expect(JSON.stringify(status)).toBe(before);
    expect(() => buildQaWorklist({ ...snapshot, generated_at: "2026-11-29T01:38:00.000Z" }, status)).toThrow(/different exports/);
  });

  it("includes ABOUT only when needed, capped, and serializes to valid JSON with one line per event", () => {
    const long = "Techno all night. ".repeat(200);
    const { snapshot, status } = setup([row("e1", { description: long })]);
    const w = buildQaWorklist(snapshot, status);
    expect(w.events[0].about?.length).toBe(1200);
    expect(w.events[0].about_truncated).toBe(true);
    const text = serializeQaWorklist(w);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(w)));
    expect(text.split("\n").filter((l) => l.startsWith('    {"priority"'))).toHaveLength(1);
  });
});
