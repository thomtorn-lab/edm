import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { EventWithVenue } from "@/lib/queries";
import type { GenreSlug } from "@/lib/taxonomy";

/**
 * Route-level tests for the real ICS HTTP endpoint (mobile Apple Calendar
 * fix, 2026-09-13). Replaces the old `data:` URL + `download` attribute
 * approach, which iOS Safari silently ignores — tapping "Apple Calendar /
 * ICS" did nothing on iPhone even though Google Calendar and Outlook (plain
 * https deep links) worked fine. getEventBySlugWithVenue is mocked so no
 * real database is touched; buildIcsFile itself is already covered by
 * src/lib/ics.test.ts, so these tests focus on what this route adds:
 * routing, headers, and 404 handling.
 */

const VENUE = {
  id: "v-test",
  slug: "test-venue",
  name: "Hangaren",
  aliases: [],
  address: "Refshalevej 325, 1432 København K",
  city: "Copenhagen" as const,
  postalCode: "1432",
  websiteUrl: null,
  description: "",
  shortDescription: null,
  venueProfile: null,
};

function makeEvent(overrides: Partial<EventWithVenue> = {}): EventWithVenue {
  return {
    id: "e-1",
    title: "Fast Forward",
    slug: "fast-forward",
    description: "Hard techno and industrial.",
    artists: [],
    startDatetime: "2026-08-15T23:59:00+02:00",
    endDatetime: "2026-08-16T06:00:00+02:00",
    timezone: "Europe/Copenhagen",
    venueId: VENUE.id,
    subVenue: null,
    primaryGenre: "techno" as GenreSlug,
    subgenres: ["techno"] as GenreSlug[],
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
    venue: VENUE,
    ...overrides,
  };
}

vi.mock("@/lib/queries", () => ({
  getEventBySlugWithVenue: vi.fn(),
}));

const { getEventBySlugWithVenue } = await import("@/lib/queries");
const { GET } = await import("./route");

function callRoute(slug: string) {
  const request = new NextRequest(`http://localhost/events/${slug}/calendar.ics`);
  return GET(request, { params: Promise.resolve({ slug }) });
}

describe("GET /events/[slug]/calendar.ics", () => {
  it("returns a valid calendar response with the correct Content-Type", async () => {
    vi.mocked(getEventBySlugWithVenue).mockResolvedValue(makeEvent());
    const res = await callRoute("fast-forward");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
  });

  it("sets an attachment Content-Disposition with the event slug as filename", async () => {
    vi.mocked(getEventBySlugWithVenue).mockResolvedValue(makeEvent({ slug: "fast-forward" }));
    const res = await callRoute("fast-forward");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="fast-forward.ics"');
  });

  it("includes the event title", async () => {
    vi.mocked(getEventBySlugWithVenue).mockResolvedValue(makeEvent({ title: "Fast Forward" }));
    const res = await callRoute("fast-forward");
    const body = await res.text();
    expect(body).toContain("SUMMARY:Fast Forward");
  });

  it("preserves the correct Copenhagen date/time as UTC instants", async () => {
    vi.mocked(getEventBySlugWithVenue).mockResolvedValue(
      makeEvent({ startDatetime: "2026-08-15T23:59:00+02:00", endDatetime: "2026-08-16T06:00:00+02:00" }),
    );
    const res = await callRoute("fast-forward");
    const body = await res.text();
    // 23:59 CEST (+02:00) on Aug 15 = 21:59 UTC; 06:00 CEST on Aug 16 = 04:00 UTC.
    expect(body).toContain("DTSTART:20260815T215900Z");
    expect(body).toContain("DTEND:20260816T040000Z");
  });

  it("preserves the venue/location", async () => {
    vi.mocked(getEventBySlugWithVenue).mockResolvedValue(makeEvent());
    const res = await callRoute("fast-forward");
    const body = await res.text();
    expect(body).toContain("LOCATION:Hangaren\\, Refshalevej 325");
  });

  it("includes the canonical Electronic CPH event URL", async () => {
    vi.mocked(getEventBySlugWithVenue).mockResolvedValue(makeEvent({ slug: "fast-forward" }));
    const res = await callRoute("fast-forward");
    const body = await res.text();
    expect(body).toContain("URL:https://electroniccph.com/events/fast-forward");
  });

  it("applies the same venue-name title cleanup as the event detail page (e.g. Pumpehuset prefix stripping)", async () => {
    vi.mocked(getEventBySlugWithVenue).mockResolvedValue(
      makeEvent({ title: "Byhaven: Shrek Rave", venue: { ...VENUE, name: "Pumpehuset" } }),
    );
    const res = await callRoute("fast-forward");
    const body = await res.text();
    expect(body).toContain("SUMMARY:Shrek Rave");
  });

  it("returns 404 for an unknown slug, without throwing", async () => {
    vi.mocked(getEventBySlugWithVenue).mockResolvedValue(undefined);
    const res = await callRoute("does-not-exist");
    expect(res.status).toBe(404);
  });
});
