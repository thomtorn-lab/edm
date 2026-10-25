import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Public event queries and About-text presentation (2026-10-25): a
 * description made only of bare labels is dropped, a practical-only one is
 * marked, and every other description — in any language — is passed through
 * unchanged. Each db.select().from().where() call returns the next queued
 * result: events, then their venues.
 */
let queue: unknown[][] = [];
const chain = () => ({
  from: () => ({
    where: () => {
      const r = queue.shift() ?? [];
      const p = Promise.resolve(r) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
      p.limit = () => Promise.resolve(r);
      return p;
    },
  }),
});
vi.mock("@/db/client", () => ({ db: { select: () => chain() } }));

const { getPublishedEventsWithVenue, getEventBySlugWithVenue, getEventsForVenue } = await import("./queries");

const DANISH = "Den amerikanske artist WITCHZ står klar til at forvandle Pumpehuset til et univers af dybe baslinjer.";
const PRACTICAL = "Doors open at 20:00. Cloakroom is mandatory, tickets at the door, age limit 18+ and contact info@vega.dk.";

function eventRow(id: string, description: string | null) {
  const d = new Date("2026-11-13T19:00:00.000Z");
  return {
    id, title: id, slug: id, description, artists: [], startDatetime: d, endDatetime: null, venueId: "v1", subVenue: null,
    primaryGenre: "techno", subgenres: ["techno"], genreConfidence: "high", officialEventUrl: null, ticketUrl: null,
    facebookUrl: null, residentAdvisorUrl: null, otherSourceUrls: [], imageUrl: null, priceFrom: null, currency: null,
    soldOut: false, cancelled: false, postponed: false, dateChanged: false, timeChanged: false, published: true,
    adminUnpublishReason: null, adminUnpublishNote: null, adminUnpublishedAt: null, sourceCancelledAt: null,
    sourceCancelledBySourceId: null, sourceCancellationEvidence: null, manualOverride: false, overriddenFields: [],
    confidence: "high", canonicalSourceId: null, createdAt: d, updatedAt: d, lastSourceCheck: null, lastChanged: null,
  };
}
const VENUE_ROW = { id: "v1", slug: "v1", name: "Pumpehuset", aliases: [], rooms: [], address: "x", city: "Copenhagen", postalCode: "1", websiteUrl: null, description: null, shortDescription: null, venueProfile: null };

beforeEach(() => {
  queue = [];
});

describe("public event queries: About kind", () => {
  it("passes descriptions through unchanged in any language; marks practical-only; drops bare labels", async () => {
    queue = [[eventRow("da", DANISH), eventRow("practical", PRACTICAL), eventRow("labels", "Praktisk info:.\n\nEntré"), eventRow("none", null)], [VENUE_ROW]];
    const events = await getPublishedEventsWithVenue();
    expect(events.map((e) => [e.id, e.description, e.aboutKind])).toEqual([
      ["da", DANISH, "about"],
      ["practical", PRACTICAL, "practical"],
      ["labels", null, null],
      ["none", null, null],
    ]);
  });

  it("event page and venue page get the same treatment", async () => {
    queue = [[eventRow("e", PRACTICAL)], [VENUE_ROW]];
    expect((await getEventBySlugWithVenue("e"))?.aboutKind).toBe("practical");
    queue = [[eventRow("e", DANISH)], [VENUE_ROW]];
    expect((await getEventsForVenue("v1"))[0].description).toBe(DANISH);
  });
});
