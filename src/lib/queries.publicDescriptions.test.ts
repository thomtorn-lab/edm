import { beforeEach, describe, expect, it, vi } from "vitest";
import { descriptionHash } from "./translation/englishDescription";

/**
 * Wiring test for English-only About texts (2026-10-24): every public event
 * query replaces `description` with the publishable English text (or null),
 * so a non-English original can't reach the event page, cards, calendar
 * links or JSON-LD. Each db.select().from().where() call returns the next
 * queued result: events, then their venues, then cached translations.
 */
let queue: unknown[][] = [];
let throwOnCall: number | null = null;
let call = 0;
const chain = () => {
  const n = call++;
  const result = () => {
    if (n === throwOnCall) throw new Error('relation "event_description_translations" does not exist');
    return queue.shift() ?? [];
  };
  return {
    from: () => ({
      where: () => {
        const r = result();
        const p = Promise.resolve(r) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
        p.limit = () => Promise.resolve(r);
        return p;
      },
    }),
  };
};
vi.mock("@/db/client", () => ({ db: { select: () => chain() } }));

const { getPublishedEventsWithVenue, getEventBySlugWithVenue, getEventsForVenue } = await import("./queries");

const DA = "Den amerikanske artist WITCHZ står klar til at forvandle Pumpehuset til et univers af dybe baslinjer.";
const EN_TRANSLATION = "The American artist WITCHZ is ready to transform Pumpehuset into a universe of deep basslines.";
const EN_ORIGINAL = "Pink Monkey returns to KB3 for a full night of house and disco with the residents and friends from all over the city.";

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
  throwOnCall = null;
  call = 0;
});

describe("public event queries: English-only descriptions", () => {
  it("homepage list: translated → English; untranslated Danish → null; English original → kept; none → null", async () => {
    queue = [
      [eventRow("translated", DA), eventRow("pending", DA), eventRow("english", EN_ORIGINAL), eventRow("empty", null)],
      [VENUE_ROW],
      [{ eventId: "translated", sourceHash: descriptionHash(DA), status: "translated", translatedText: EN_TRANSLATION }],
    ];
    const events = await getPublishedEventsWithVenue();
    expect(Object.fromEntries(events.map((e) => [e.id, e.description]))).toEqual({
      translated: EN_TRANSLATION,
      pending: null,
      english: EN_ORIGINAL,
      empty: null,
    });
  });

  it("event page: a translation of an older text is never used for the current Danish text", async () => {
    queue = [[eventRow("e", DA)], [VENUE_ROW], [{ eventId: "e", sourceHash: descriptionHash("older text"), status: "translated", translatedText: "OLD" }]];
    expect((await getEventBySlugWithVenue("e"))?.description).toBeNull();
  });

  it("bare labels with no value are not shown; practical-only text is shown and marked as such", async () => {
    const practical = "Doors open at 20:00. Cloakroom is mandatory, tickets at the door, age limit 18+ and contact info@vega.dk.";
    queue = [[eventRow("empty", "Praktisk info:.\n\nEntré"), eventRow("practical", practical)], [VENUE_ROW], []];
    const events = await getPublishedEventsWithVenue();
    expect(events.map((e) => [e.id, e.description, e.aboutKind])).toEqual([
      ["empty", null, null],
      ["practical", practical, "practical"],
    ]);
  });

  it("venue page list gets the same treatment", async () => {
    queue = [[eventRow("e", DA)], [VENUE_ROW], []];
    expect((await getEventsForVenue("v1"))[0].description).toBeNull();
  });

  it("a failing translation lookup never breaks the page and still shows no Danish", async () => {
    queue = [[eventRow("da", DA), eventRow("en", EN_ORIGINAL)], [VENUE_ROW]];
    throwOnCall = 2;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await getPublishedEventsWithVenue();
    expect(events.map((e) => e.description)).toEqual([null, EN_ORIGINAL]);
    errorSpy.mockRestore();
  });
});
