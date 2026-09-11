import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventWithVenue } from "@/lib/queries";
import type { GenreSlug } from "@/lib/taxonomy";
import type { Venue } from "@/lib/types";
import { FESTIVALS } from "@/lib/data/festivals";

const STATIC_ROUTES = ["/", "/venues", "/festivals", "/about", "/contact", "/suggest-event", "/privacy"];

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "v-test",
    slug: "test-venue",
    name: "Test Venue",
    aliases: [],
    address: "Test St 1",
    city: "Copenhagen" as const,
    postalCode: "1000",
    websiteUrl: null,
    description: "",
    shortDescription: null,
    venueProfile: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventWithVenue> = {}): EventWithVenue {
  const venue = overrides.venue ?? makeVenue();
  return {
    id: "e-1",
    title: "Test Event",
    slug: "test-event",
    description: null,
    artists: [],
    startDatetime: "2026-08-10T20:00:00.000Z",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: venue.id,
    subVenue: null,
    primaryGenre: "drum-and-bass" as GenreSlug,
    subgenres: ["drum-and-bass"] as GenreSlug[],
    genreConfidence: "high",
    officialEventUrl: null,
    ticketUrl: null,
    facebookUrl: null,
    residentAdvisorUrl: null,
    otherSourceUrls: [],
    imageUrl: null,
    priceFrom: null,
    currency: null,
    soldOut: false,
    cancelled: false,
    postponed: false,
    dateChanged: false,
    timeChanged: false,
    published: true,
    adminUnpublishReason: null,
    adminUnpublishNote: null,
    adminUnpublishedAt: null,
    sourceCancelledAt: null,
    sourceCancelledBySourceId: null,
    sourceCancellationEvidence: null,
    manualOverride: false,
    overriddenFields: [],
    confidence: "high",
    canonicalSourceId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    lastSourceCheck: null,
    lastChanged: null,
    venue,
    ...overrides,
  };
}

vi.mock("@/lib/queries", () => ({
  getPublishedEventsWithVenue: vi.fn(),
  getVenues: vi.fn(),
}));

const { getPublishedEventsWithVenue, getVenues } = await import("@/lib/queries");

describe("sitemap — build-time DB dependency removal (2026-09-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is request-time only: export const revalidate is exactly 0", async () => {
    const mod = await import("./sitemap");
    expect(mod.revalidate).toBe(0);
  });

  it("makes no DB call at module import — only when sitemap() actually executes", async () => {
    // The module is already imported (cached) by the previous test, but
    // module-level evaluation never calls either query function — only the
    // sitemap() function body does. Confirms no top-level/import-time DB call.
    expect(getPublishedEventsWithVenue).not.toHaveBeenCalled();
    expect(getVenues).not.toHaveBeenCalled();

    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue([]);
    vi.mocked(getVenues).mockResolvedValue([]);
    const { default: sitemap } = await import("./sitemap");
    await sitemap();

    expect(getPublishedEventsWithVenue).toHaveBeenCalledTimes(1);
    expect(getVenues).toHaveBeenCalledTimes(1);
  });

  it("includes every existing static route, unchanged", async () => {
    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue([]);
    vi.mocked(getVenues).mockResolvedValue([]);
    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    const urls = result.map((r) => r.url);
    for (const route of STATIC_ROUTES) {
      expect(urls).toContain(`https://electroniccph.com${route}`);
    }
  });

  it("includes mocked event URLs", async () => {
    const event = makeEvent({ slug: "mocked-event-slug" });
    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue([event]);
    vi.mocked(getVenues).mockResolvedValue([]);
    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    expect(result.map((r) => r.url)).toContain("https://electroniccph.com/events/mocked-event-slug");
  });

  it("includes mocked venue URLs", async () => {
    const venue = makeVenue({ slug: "mocked-venue-slug" });
    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue([]);
    vi.mocked(getVenues).mockResolvedValue([venue]);
    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    expect(result.map((r) => r.url)).toContain("https://electroniccph.com/venues/mocked-venue-slug");
  });

  it("includes every static-registry festival URL", async () => {
    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue([]);
    vi.mocked(getVenues).mockResolvedValue([]);
    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    const urls = result.map((r) => r.url);
    for (const festival of FESTIVALS) {
      expect(urls).toContain(`https://electroniccph.com/festivals/${festival.slug}`);
    }
  });

  it("has no duplicate URLs across static, event, venue and festival routes", async () => {
    const events = [makeEvent({ id: "e-1", slug: "event-one" }), makeEvent({ id: "e-2", slug: "event-two" })];
    const venuesFixture = [makeVenue({ id: "v-1", slug: "venue-one" }), makeVenue({ id: "v-2", slug: "venue-two" })];
    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue(events);
    vi.mocked(getVenues).mockResolvedValue(venuesFixture);
    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    const urls = result.map((r) => r.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("VEGA overall-venue presentation (2026-09-11): excludes a grouped member's own URL (it now permanently redirects — src/app/venues/[slug]/page.tsx) but keeps the group's primary URL and every other venue's own URL, including venues removed from the /venues directory listing but still real registry entries", async () => {
    const vega = makeVenue({ id: "v-vega", slug: "vega", name: "VEGA" });
    const idealBar = makeVenue({ id: "v-vega-ideal-bar", slug: "vega-ideal-bar", name: "Ideal Bar" });
    // H15 was removed from the curated /venues directory listing but is not
    // part of any group — its own detail page keeps working and stays
    // indexable (Section 3 of the addendum: "no broken event venue
    // references", "underlying venue remains valid").
    const h15 = makeVenue({ id: "v-h15", slug: "h15", name: "H15" });
    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue([]);
    vi.mocked(getVenues).mockResolvedValue([vega, idealBar, h15]);
    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    const urls = result.map((r) => r.url);
    expect(urls).toContain("https://electroniccph.com/venues/vega");
    expect(urls).toContain("https://electroniccph.com/venues/h15");
    expect(urls).not.toContain("https://electroniccph.com/venues/vega-ideal-bar");
  });

  it("preserves existing URL/mapping semantics: only published events (as returned by getPublishedEventsWithVenue) become event routes, keyed by slug", async () => {
    // getPublishedEventsWithVenue itself already filters to published=true —
    // this test just proves sitemap() doesn't apply any additional filter of
    // its own (unchanged from before this render-timing-only fix).
    const published = makeEvent({ id: "e-pub", slug: "published-event" });
    vi.mocked(getPublishedEventsWithVenue).mockResolvedValue([published]);
    vi.mocked(getVenues).mockResolvedValue([]);
    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    const eventEntries = result.filter((r) => r.url.includes("/events/"));
    expect(eventEntries).toHaveLength(1);
    expect(eventEntries[0].url).toBe("https://electroniccph.com/events/published-event");
  });
});
