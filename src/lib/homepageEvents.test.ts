import { describe, expect, it } from "vitest";
import { isPastEvent } from "./datetime";
import { toHomepageEvent, upcomingForHomepage } from "./homepageEvents";
import { googleCalendarUrl, outlookCalendarUrl, type CalendarEventInput } from "./ics";
import type { EventWithVenue } from "./queries";
import type { GenreSlug } from "./taxonomy";
import type { Venue } from "./types";

const VENUE: Venue = {
  id: "v-test",
  slug: "test-venue",
  name: "Test Venue",
  aliases: ["Test Club"],
  rooms: [{ name: "Main" }] as Venue["rooms"],
  address: "Test St 1, 1000 København K",
  city: "Copenhagen",
  postalCode: "1000",
  websiteUrl: "https://example.com",
  description: "A club.",
  shortDescription: "Short.",
  venueProfile: "A long venue profile that the homepage never shows.",
};

function makeEvent(id: string, startDatetime: string, endDatetime: string | null, overrides: Partial<EventWithVenue> = {}): EventWithVenue {
  return {
    id,
    title: `Event ${id}`,
    slug: `event-${id}`,
    description: "Line one.\n\nLine two — with æøå and a long tail that must reach the calendar untouched.",
    artists: ["DJ A", "DJ B"],
    startDatetime,
    endDatetime,
    timezone: "Europe/Copenhagen",
    venueId: VENUE.id,
    subVenue: null,
    primaryGenre: "techno" as GenreSlug,
    subgenres: ["techno", "house"] as GenreSlug[],
    genreConfidence: "high",
    officialEventUrl: "https://example.com/event",
    ticketUrl: "https://tickets.example.com/x",
    facebookUrl: null,
    residentAdvisorUrl: null,
    otherSourceUrls: [],
    imageUrl: "https://example.com/image.jpg",
    priceFrom: 100,
    currency: "DKK",
    soldOut: false,
    cancelled: false,
    postponed: false,
    dateChanged: false,
    timeChanged: false,
    published: true,
    adminUnpublishReason: null,
    adminUnpublishNote: "internal note",
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

const ids = (events: { id: string }[]) => events.map((e) => e.id);

describe("upcomingForHomepage — server-side past-event filter (Europe/Copenhagen)", () => {
  it("keeps an event with no end until 06:00 Copenhagen time the next morning, not until midnight", () => {
    // Fri 23 Oct 2026, 23:00 CEST, no end time.
    const event = makeEvent("late", "2026-10-23T23:00:00+02:00", null);
    expect(ids(upcomingForHomepage([event], new Date("2026-10-24T00:00:00+02:00")))).toEqual(["late"]); // midnight
    expect(ids(upcomingForHomepage([event], new Date("2026-10-24T05:59:59+02:00")))).toEqual(["late"]);
    expect(ids(upcomingForHomepage([event], new Date("2026-10-24T06:00:00+02:00")))).toEqual([]);
  });

  it("treats an event starting after midnight as part of the previous night (same 06:00 cutoff)", () => {
    // Sat 00:30 belongs to Friday night.
    const event = makeEvent("after-midnight", "2026-10-24T00:30:00+02:00", null);
    expect(ids(upcomingForHomepage([event], new Date("2026-10-24T05:59:59+02:00")))).toEqual(["after-midnight"]);
    expect(ids(upcomingForHomepage([event], new Date("2026-10-24T06:00:00+02:00")))).toEqual([]);
  });

  it("keeps an event whose stated end runs past midnight until that end, then drops it", () => {
    const event = makeEvent("all-nighter", "2026-10-23T23:59:00+02:00", "2026-10-24T08:00:00+02:00");
    expect(ids(upcomingForHomepage([event], new Date("2026-10-24T07:59:59+02:00")))).toEqual(["all-nighter"]);
    expect(ids(upcomingForHomepage([event], new Date("2026-10-24T08:00:00+02:00")))).toEqual([]);
  });

  it("drops an event ending exactly at midnight once midnight has passed", () => {
    const event = makeEvent("to-midnight", "2026-10-23T22:00:00+02:00", "2026-10-24T00:00:00+02:00");
    expect(ids(upcomingForHomepage([event], new Date("2026-10-23T23:59:59+02:00")))).toEqual(["to-midnight"]);
    expect(ids(upcomingForHomepage([event], new Date("2026-10-24T00:00:00+02:00")))).toEqual([]);
  });

  it("uses the Copenhagen wall clock across the DST change (06:00 CET on 25 Oct 2026 is 05:00Z)", () => {
    const event = makeEvent("dst", "2026-10-24T23:00:00+02:00", null);
    expect(ids(upcomingForHomepage([event], new Date("2026-10-25T04:59:59Z")))).toEqual(["dst"]);
    expect(ids(upcomingForHomepage([event], new Date("2026-10-25T05:00:00Z")))).toEqual([]);
  });

  it("ignores an untrustworthy end (not after the start) and falls back to the 06:00 cutoff", () => {
    const event = makeEvent("bad-end", "2026-10-23T23:00:00+02:00", "2026-10-23T23:00:00+02:00");
    expect(ids(upcomingForHomepage([event], new Date("2026-10-24T05:00:00+02:00")))).toEqual(["bad-end"]);
  });

  it("matches EventExplorer's own isPastEvent check exactly and keeps the input order", () => {
    const events = [
      makeEvent("a", "2026-10-25T22:00:00+01:00", null),
      makeEvent("b", "2026-10-23T23:00:00+02:00", null),
      makeEvent("c", "2026-10-23T20:00:00+02:00", "2026-10-23T23:00:00+02:00"),
      makeEvent("d", "2026-10-22T23:59:00+02:00", "2026-10-26T06:00:00+01:00"),
      makeEvent("e", "2026-10-24T01:00:00+02:00", null),
    ];
    for (const iso of ["2026-10-23T21:00:00+02:00", "2026-10-23T23:30:00+02:00", "2026-10-24T03:00:00+02:00", "2026-10-24T06:00:00+02:00", "2026-10-26T10:00:00+01:00"]) {
      const now = new Date(iso);
      expect(ids(upcomingForHomepage(events, now)), iso).toEqual(ids(events.filter((e) => !isPastEvent(e, now))));
    }
  });
});

describe("toHomepageEvent — minimal projection", () => {
  const full = makeEvent("p", "2026-10-23T23:00:00+02:00", "2026-10-24T05:00:00+02:00", {
    canonicalSourceId: "src-billetto",
    overriddenFields: ["officialEventUrl"],
    subVenue: "Main",
  });
  const projected = toHomepageEvent(full, true);

  it("carries only the fields the homepage reads", () => {
    expect(Object.keys(projected).sort()).toEqual(
      [
        "artists", "canonicalSourceId", "dateChanged", "description", "endDatetime", "facebookUrl", "hasArtistPreview", "id",
        "officialEventUrl", "otherSourceUrls", "overriddenFields", "postponed", "priceFrom", "primaryGenre", "residentAdvisorUrl",
        "slug", "soldOut", "startDatetime", "subVenue", "subgenres", "ticketUrl", "title", "venue",
      ].sort(),
    );
    expect(Object.keys(projected.venue).sort()).toEqual(["address", "aliases", "id", "name", "slug"]);
    // Admin/audit metadata and venue copy never reach the client.
    expect(JSON.stringify(projected)).not.toContain("internal note");
    expect(JSON.stringify(projected)).not.toContain("venue profile");
  });

  it("copies every carried value unchanged", () => {
    for (const [key, value] of Object.entries(projected)) {
      if (key === "venue" || key === "hasArtistPreview") continue;
      expect(value, key).toEqual(full[key as keyof EventWithVenue]);
    }
    expect(projected.hasArtistPreview).toBe(true);
  });

  it("keeps the calendar button's content identical (full description, times, venue, links)", () => {
    const input = (e: Pick<EventWithVenue, "title" | "description" | "startDatetime" | "endDatetime" | "slug"> & { venue: { name: string; address: string } }): CalendarEventInput => ({
      title: e.title,
      description: e.description,
      startDatetime: e.startDatetime,
      endDatetime: e.endDatetime,
      venue: e.venue,
      eventUrl: `https://www.electroniccph.com/events/${e.slug}`,
    });
    expect(googleCalendarUrl(input(projected))).toBe(googleCalendarUrl(input(full)));
    expect(outlookCalendarUrl(input(projected))).toBe(outlookCalendarUrl(input(full)));
    expect(projected.description).toBe(full.description);
  });
});
