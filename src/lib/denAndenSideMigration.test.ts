import { describe, expect, it } from "vitest";
import { planDenAndenSideMigration, planEvent, type DasEventSnapshot } from "./denAndenSideMigration";
import { structureDenAndenSideRooms } from "./denAndenSideRooms";

function ev(over: Partial<DasEventSnapshot>): DasEventSnapshot {
  return {
    id: "evt-1",
    slug: "some-night-evt-1",
    title: "Some Night",
    description: "A night of techno.",
    artists: ["A"],
    venueId: "v-den-anden-side",
    venueName: "Den Anden Side",
    startDatetime: "2026-11-06T22:59:00.000Z",
    published: true,
    cancelled: false,
    overriddenFields: [],
    canonicalSourceId: "src-hvaderpaa",
    officialEventUrl: "https://hvaderpaa.dk/da/event/1/",
    residentAdvisorUrl: null,
    ...over,
  };
}

const TWO_ROOMS = {
  title: "GAG x DAS",
  artists: ["A1", "A2", "B1"],
  description: "Lineup\nDen Anden Side: A1, A2\nDen Anden Ende: B1",
};

describe("planEvent", () => {
  it("restructures a verified two-room night, touching only title/description/artist order", () => {
    const p = planEvent(ev({ ...TWO_ROOMS, artists: ["B1", "A1", "A2"] }));
    expect(p.outcome).toBe("update");
    expect(p.verdict).toBe("two-rooms");
    expect(Object.keys(p.patch).sort()).toEqual(["artists", "description"]);
    expect(p.patch.artists).toEqual(["A1", "A2", "B1"]);
    expect(new Set(p.patch.artists)).toEqual(new Set(["B1", "A1", "A2"]));
  });

  it("produces exactly what a fresh import would", () => {
    const fresh = structureDenAndenSideRooms(TWO_ROOMS);
    const p = planEvent(ev(TWO_ROOMS));
    expect(p.patch.description).toBe(fresh.description);
  });

  it("is a no-op on an already migrated event", () => {
    const fresh = structureDenAndenSideRooms({ title: "Kilele x DAS at Den Anden Ende", artists: ["Kilele"], description: "x" });
    expect(planEvent(ev({ title: fresh.title, description: fresh.description, artists: fresh.artists })).outcome).toBe("unchanged");
  });

  it("never overwrites an admin-edited field — reports it instead", () => {
    const p = planEvent(ev({ ...TWO_ROOMS, overriddenFields: ["description"] }));
    expect(p.outcome).toBe("unresolved");
    expect(p.patch).toEqual({});
    expect(p.reason).toContain("admin");
  });

  it("reports unverifiable splits and leaves the event alone", () => {
    const p = planEvent(ev({ artists: ["A", "B"], description: "A in the main room, B on the small dancefloor." }));
    expect(p.outcome).toBe("unresolved");
    expect(p.patch).toEqual({});
  });

  it("moves an event off a stray 'Den Anden Ende' venue and treats it as a small-room night", () => {
    const p = planEvent(ev({ venueId: "v-den-anden-ende", venueName: "Den Anden Ende", title: "Open Decks", artists: [] }));
    expect(p.outcome).toBe("update");
    expect(p.patch.venueId).toBe("v-den-anden-side");
    expect(p.patch.title).toBe("Den Anden Ende: Open Decks");
  });

  it("leaves ordinary nights unchanged", () => {
    const p = planEvent(ev({}));
    expect(p.outcome).toBe("unchanged");
    expect(p.verdict).toBe("no-room-info");
  });
});

describe("planDenAndenSideMigration", () => {
  it("counts every event once and flags same-night room events without merging them", () => {
    const plan = planDenAndenSideMigration([
      ev({ id: "main", title: "Club Night", startDatetime: "2026-11-06T22:59:00.000Z" }),
      ev({ id: "small", title: "Miss Thing at Den Anden Ende", artists: [], startDatetime: "2026-11-06T22:59:00.000Z" }),
      ev({ id: "other", ...TWO_ROOMS, startDatetime: "2026-11-13T22:59:00.000Z" }),
      ev({ id: "unclear", artists: ["A", "B"], description: "second room: tba", startDatetime: "2026-11-20T22:59:00.000Z" }),
    ]);
    expect(plan.counts).toEqual({ reviewed: 4, update: 2, unchanged: 1, unresolved: 1 });
    expect(plan.sameNightGroups).toHaveLength(1);
    expect(plan.sameNightGroups[0].date).toBe("2026-11-06");
    expect(plan.sameNightGroups[0].events.map((e) => e.id).sort()).toEqual(["main", "small"]);
  });
});
