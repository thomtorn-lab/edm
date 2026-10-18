import { describe, expect, it } from "vitest";
import { sourceHasVenueAuthority } from "./data/officialSourceVenues";
import {
  assessTicketReplacementIdentity,
  decideTicketReplacementShadow,
  shadowDecisionId,
  summarizeShadowDecisions,
  type ShadowCandidate,
  type ShadowContext,
  type ShadowEvent,
} from "./ticketReplacementShadow";

// Saturday 2026-11-07 23:00 Copenhagen.
const NIGHT_START = "2026-11-07T22:00:00.000Z";

function event(overrides: Partial<ShadowEvent> = {}): ShadowEvent {
  return {
    id: "e-ben",
    title: "Ben UFO all night long",
    artists: ["Ben UFO"],
    venueId: "v-culture-box",
    subVenue: "Black Box",
    startDatetime: NIGHT_START,
    ticketUrl: "https://ra.co/events/111",
    officialEventUrl: "https://culture-box.com/events/ben-ufo",
    residentAdvisorUrl: null,
    overriddenFields: [],
    published: true,
    ...overrides,
  };
}

function candidate(overrides: Partial<ShadowCandidate> = {}): ShadowCandidate {
  return {
    sourceId: "src-culture-box",
    title: "Ben UFO all night long",
    artists: ["Ben UFO"],
    venueId: "v-culture-box",
    subVenue: "Black Box",
    startDatetime: NIGHT_START,
    ticketUrl: "https://tickets.example/ben-ufo",
    officialEventUrl: null,
    residentAdvisorUrl: null,
    ...overrides,
  };
}

function ctx(stored: ShadowEvent, others: ShadowEvent[] = [], linkedEventId: string | null = null): ShadowContext {
  return { linkedEventId, allEvents: [stored, ...others] };
}

function decide(c: ShadowCandidate, e: ShadowEvent, others: ShadowEvent[] = [], linkedEventId: string | null = null) {
  return decideTicketReplacementShadow(c, e, ctx(e, others, linkedEventId));
}

describe("ticket-replacement shadow — would_replace (positive)", () => {
  it("linked by the source's own URL, same night/venue/room, lineup matches", () => {
    const e = event();
    const d = decide(candidate({ title: "Saturday: Ben UFO" }), e, [], e.id);
    expect(d.outcome).toBe("would_replace");
    expect(d.identity?.level).toBe("strong");
    expect(d.identity?.anchors).toEqual(["linked"]);
    expect(d.explanation.at(-1)).toMatch(/WOULD replace/);
  });

  it("no anchor, but lineup AND title both match", () => {
    const d = decide(candidate(), event());
    expect(d.outcome).toBe("would_replace");
    expect(d.identity?.anchors).toEqual([]);
    expect(d.identity?.checks).toMatchObject({ date: "pass", venue: "pass", room: "pass", lineup: "pass", title: "pass", unique: "pass" });
  });

  it("a shared official event page plus lineup counts", () => {
    const e = event();
    const d = decide(candidate({ title: "Saturday", officialEventUrl: e.officialEventUrl }), e);
    expect(d.outcome).toBe("would_replace");
    expect(d.identity?.anchors).toEqual(["official_event_url"]);
  });

  it("Gravity has authority over TAP1 (promoter renting the room)", () => {
    const e = event({ venueId: "v-tap1", subVenue: null });
    const d = decide(candidate({ sourceId: "src-gravity", venueId: "v-tap1", subVenue: null }), e);
    expect(d.outcome).toBe("would_replace");
  });
});

describe("ticket-replacement shadow — a ticket URL is never identity evidence", () => {
  it("RA URL that IS the stored ticket link is discarded: withheld ticket_url_only_identity", () => {
    const e = event();
    const d = decide(candidate({ title: "Saturday at Culture Box", artists: [], residentAdvisorUrl: e.ticketUrl }), e);
    expect(d.outcome).toBe("withheld");
    expect(d.withheldReason).toBe("ticket_url_only_identity");
    expect(d.identity?.discardedTicketAnchors).toEqual(["candidate_ra=event_ticket"]);
    expect(d.identity?.anchors).toEqual([]);
    expect(d.identity?.level).toBe("weak");
  });

  it("official URL equal to the incoming ticket link is discarded too", () => {
    const e = event({ officialEventUrl: "https://tickets.example/ben-ufo" });
    const d = decide(candidate({ title: "Club night", artists: [], officialEventUrl: "https://tickets.example/ben-ufo" }), e);
    expect(d.withheldReason).toBe("ticket_url_only_identity");
    expect(d.identity?.discardedTicketAnchors).toEqual(["official_event_url", "candidate_ticket=event_official"]);
  });

  it("RA URL as ticket link still counts as nothing even when the lineup is unknown and the title differs", () => {
    const e = event({ residentAdvisorUrl: "https://ra.co/events/111" });
    const d = decide(candidate({ title: "Club night", artists: [], residentAdvisorUrl: "https://ra.co/events/111" }), e);
    expect(d.outcome).toBe("withheld");
    expect(d.identity?.level).not.toBe("strong");
  });
});

describe("ticket-replacement shadow — an anchor alone is not enough", () => {
  it("shared official event page without lineup or title evidence: insufficient_identity", () => {
    const e = event();
    const d = decide(candidate({ title: "Club night", artists: [], officialEventUrl: e.officialEventUrl }), e);
    expect(d.withheldReason).toBe("insufficient_identity");
    expect(d.identity?.anchors).toEqual(["official_event_url"]);
  });

  it("shared RA event page without content evidence: insufficient_identity", () => {
    const e = event({ residentAdvisorUrl: "https://ra.co/events/999" });
    const d = decide(candidate({ title: "Club night", artists: [], residentAdvisorUrl: "https://ra.co/events/999" }), e);
    expect(d.withheldReason).toBe("insufficient_identity");
  });

  it("candidate's RA page equal to the event's official page counts as an anchor, but still needs content", () => {
    const e = event({ officialEventUrl: "https://ra.co/events/555" });
    const withContent = decide(candidate({ title: "Saturday", residentAdvisorUrl: "https://ra.co/events/555" }), e);
    expect(withContent.identity?.anchors).toEqual(["candidate_ra=event_official"]);
    expect(withContent.outcome).toBe("would_replace");
    const without = decide(candidate({ title: "Club night", artists: [], residentAdvisorUrl: "https://ra.co/events/555" }), e);
    expect(without.withheldReason).toBe("insufficient_identity");
  });

  it("linked alone without content evidence: insufficient_identity", () => {
    const e = event();
    const d = decide(candidate({ title: "Club night", artists: [] }), e, [], e.id);
    expect(d.withheldReason).toBe("insufficient_identity");
  });

  it("title alone (no anchor, lineup unknown): insufficient_identity", () => {
    const d = decide(candidate({ artists: [] }), event());
    expect(d.withheldReason).toBe("insufficient_identity");
  });
});

describe("ticket-replacement shadow — date, time, venue, room, lineup checked independently", () => {
  it("moved event: different night, same lineup", () => {
    const d = decide(candidate({ startDatetime: "2026-11-14T22:00:00.000Z" }), event(), [], "e-ben");
    expect(d.withheldReason).toBe("moved_event");
    expect(d.identity?.checks.date).toBe("fail");
  });

  it("different night with nothing in common: different_night", () => {
    const d = decide(candidate({ startDatetime: "2026-11-14T22:00:00.000Z", title: "Other party", artists: ["Someone Else"] }), event());
    expect(d.withheldReason).toBe("different_night");
  });

  it("unknown candidate date is never strong", () => {
    const d = decide(candidate({ startDatetime: null }), event());
    expect(d.withheldReason).toBe("insufficient_identity");
    expect(d.identity?.checks.date).toBe("unknown");
  });

  it("two shows the same evening (start 4h apart): multiple_shows_same_evening", () => {
    const d = decide(candidate({ startDatetime: "2026-11-07T18:00:00.000Z" }), event());
    expect(d.withheldReason).toBe("multiple_shows_same_evening");
    expect(d.identity?.checks.time).toBe("fail");
  });

  it("start within 60 minutes passes the time check", () => {
    const d = decide(candidate({ startDatetime: "2026-11-07T22:45:00.000Z" }), event());
    expect(d.outcome).toBe("would_replace");
  });

  it("different known rooms the same night: room_conflict", () => {
    const d = decide(candidate({ subVenue: "Red Box" }), event(), [], "e-ben");
    expect(d.withheldReason).toBe("room_conflict");
  });

  it("candidate venue unresolved: venue_mismatch", () => {
    const d = decide(candidate({ venueId: null }), event());
    expect(d.withheldReason).toBe("venue_mismatch");
  });

  it("both lineups known with no shared artist: lineup_conflict", () => {
    const d = decide(candidate({ artists: ["Someone Else"] }), event(), [], "e-ben");
    expect(d.withheldReason).toBe("lineup_conflict");
  });
});

describe("ticket-replacement shadow — shared ticket pages and competing matches", () => {
  it("incoming ticket link already used by another event (festival pass): shared_ticket_page", () => {
    const other = event({ id: "e-other", startDatetime: "2026-11-08T22:00:00.000Z", ticketUrl: "https://tickets.example/ben-ufo" });
    const d = decide(candidate(), event(), [other]);
    expect(d.withheldReason).toBe("shared_ticket_page");
    expect(d.explanation.join(" ")).toContain("e-other");
  });

  it("stored ticket link shared with another event: stored_ticket_shared", () => {
    const other = event({ id: "e-red", subVenue: "Red Box", title: "Red Box night", artists: ["X"] });
    const d = decide(candidate(), event(), [other]);
    expect(d.withheldReason).toBe("stored_ticket_shared");
  });

  it("another event the same night matches as well: ambiguous_match", () => {
    const twin = event({ id: "e-twin", subVenue: null, ticketUrl: "https://ra.co/events/222" });
    const d = decide(candidate({ subVenue: null }), event({ subVenue: null }), [twin], "e-ben");
    expect(d.withheldReason).toBe("ambiguous_match");
    expect(d.identity?.competingEventIds).toEqual(["e-twin"]);
  });

  it("an event in the other room is not a competing match", () => {
    const red = event({ id: "e-red", subVenue: "Red Box", ticketUrl: "https://ra.co/events/333" });
    const d = decide(candidate(), event(), [red]);
    expect(d.outcome).toBe("would_replace");
  });

  it("a weaker match the same night is not competing", () => {
    const weaker = event({ id: "e-weak", subVenue: null, title: "Opening", artists: ["Other DJ"], ticketUrl: "https://ra.co/events/444" });
    const d = decide(candidate(), event(), [weaker]);
    expect(d.outcome).toBe("would_replace");
  });
});

describe("ticket-replacement shadow — source rules and existing behaviour", () => {
  it("source without authority over the venue: no_venue_authority", () => {
    const d = decide(candidate({ sourceId: "src-hangaren" }), event());
    expect(d.withheldReason).toBe("no_venue_authority");
  });

  it("aggregator source: not_official_source", () => {
    const d = decide(candidate({ sourceId: "src-hvaderpaa" }), event());
    expect(d.withheldReason).toBe("not_official_source");
  });

  it("admin override of ticketUrl: override, nothing else evaluated", () => {
    const d = decide(candidate(), event({ overriddenFields: ["ticketUrl"] }));
    expect(d.withheldReason).toBe("override");
    expect(d.identity).toBeNull();
  });

  it("empty stored link: fill (existing rule, reported only)", () => {
    expect(decide(candidate(), event({ ticketUrl: null })).outcome).toBe("fill");
  });

  it("same link: confirm", () => {
    expect(decide(candidate({ ticketUrl: "https://ra.co/events/111" }), event()).outcome).toBe("confirm");
  });

  it("candidate without a ticket link never clears the stored one: no_change", () => {
    expect(decide(candidate({ ticketUrl: null }), event()).outcome).toBe("no_change");
  });
});

describe("ticket-replacement shadow — explainable and reproducible", () => {
  it("every withheld/would_replace decision has identity checks and an explanation", () => {
    const d = decide(candidate({ subVenue: "Red Box" }), event());
    expect(d.identity?.checks).toBeDefined();
    expect(d.explanation.some((l) => l.startsWith("identity checks:"))).toBe(true);
    expect(d.explanation.length).toBeGreaterThan(2);
  });

  it("same input gives the same decision and the same id", () => {
    const a = decide(candidate(), event());
    const b = decide(candidate(), event());
    expect(a).toEqual(b);
    expect(a.decisionId).toBe(shadowDecisionId("src-culture-box", "e-ben", "https://tickets.example/ben-ufo"));
    expect(a.decisionId).toMatch(/^src-culture-box:e-ben:[0-9a-f]{8}$/);
  });

  it("a different incoming link gives a different id", () => {
    expect(shadowDecisionId("src-culture-box", "e-ben", "https://a.example/1")).not.toBe(shadowDecisionId("src-culture-box", "e-ben", "https://a.example/2"));
  });

  it("assessTicketReplacementIdentity never reads the ticket link as evidence", () => {
    const e = event({ officialEventUrl: null });
    const withSameTicketPage = assessTicketReplacementIdentity(candidate({ title: "x", artists: [], officialEventUrl: e.ticketUrl }), e, ctx(e));
    expect(withSameTicketPage.anchors).toEqual([]);
  });

  it("summarizes by outcome and reason", () => {
    const s = summarizeShadowDecisions([
      decide(candidate(), event()),
      decide(candidate({ subVenue: "Red Box" }), event()),
      decide(candidate({ ticketUrl: null }), event()),
    ]);
    expect(s).toEqual({
      total: 3,
      byOutcome: { no_change: 1, fill: 0, confirm: 0, would_replace: 1, withheld: 1 },
      byWithheldReason: { room_conflict: 1 },
    });
  });
});

describe("OFFICIAL_SOURCE_VENUES", () => {
  it("grants authority only for listed venues", () => {
    expect(sourceHasVenueAuthority("src-culture-box", "v-culture-box")).toBe(true);
    expect(sourceHasVenueAuthority("src-culture-box", "v-hangaren")).toBe(false);
    expect(sourceHasVenueAuthority("src-hvaderpaa", "v-culture-box")).toBe(false);
    expect(sourceHasVenueAuthority("src-culture-box", null)).toBe(false);
  });
});

describe("shadow mode stays out of the sync/write paths", () => {
  it("only the read-only report, its CLI/evaluation and tests import the shadow modules", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.join(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(root);
    const importers = files
      .filter((f) => /from "[^"]*(ticketReplacementShadow|officialSourceVenues|ticketShadowEvaluation)"/.test(readFileSync(f, "utf-8")))
      .map((f) => path.relative(root, f))
      .sort();
    expect(importers).toEqual([
      "db/inspectSource.ts",
      "db/ticketReplacementShadow.ts",
      "db/ticketShadowEvaluateCli.ts",
      "lib/ticketReplacementShadow.ts",
      "lib/ticketShadowEvaluation.ts",
    ]);
  });
});
