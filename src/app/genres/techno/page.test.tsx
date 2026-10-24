// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { EventWithVenue } from "@/lib/queries";
import { GENRES, matchesGenreFilter, type GenreSlug } from "@/lib/taxonomy";
import type { Venue } from "@/lib/types";

const VENUE: Venue = {
  id: "v-test",
  slug: "test-venue",
  name: "Test Venue",
  aliases: [],
  address: "Test St 1",
  city: "Copenhagen",
  postalCode: "1000",
  websiteUrl: null,
  description: "",
  shortDescription: null,
  venueProfile: null,
};

function makeEvent(id: string, subgenres: GenreSlug[], startDatetime: string, overrides: Partial<EventWithVenue> = {}): EventWithVenue {
  return {
    id,
    title: `Event ${id}`,
    slug: `event-${id}`,
    description: null,
    artists: [],
    startDatetime,
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: VENUE.id,
    subVenue: null,
    primaryGenre: subgenres[0] ?? null,
    subgenres,
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
  } as EventWithVenue;
}

vi.mock("@/lib/queries", () => ({
  getPublishedEventsWithVenue: vi.fn(),
  getSoundcloudAvailabilityForEvents: vi.fn(async (list: unknown[]) => list.map(() => false)),
}));

const { getPublishedEventsWithVenue, getSoundcloudAvailabilityForEvents } = await import("@/lib/queries");
const pageModule = await import("./page");
const { default: TechnoGenrePage, metadata } = pageModule;

async function renderPage(events: EventWithVenue[]) {
  vi.mocked(getPublishedEventsWithVenue).mockResolvedValue(events);
  render(await TechnoGenrePage());
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("/genres/techno — metadata", () => {
  it("has the agreed title (absolute, brand once), a factual description and a self-canonical", () => {
    expect(metadata.title).toEqual({ absolute: "Techno Events in Copenhagen | Electronic CPH" });
    expect(metadata.description).toMatch(/^Upcoming techno events in Copenhagen/);
    expect((metadata.description as string).length).toBeLessThanOrEqual(160);
    // Relative path resolved against metadataBase (https://www.electroniccph.com) by Next.js.
    expect(metadata.alternates?.canonical).toBe("/genres/techno");
  });

  it("is request-time rendered from the DB (revalidate = 0)", () => {
    expect(pageModule.revalidate).toBe(0);
  });
});

describe("/genres/techno — page", () => {
  const FUTURE = "2099-01-01T20:00:00.000Z";

  it("keeps the AUDIO indicator: one batched lookup for the listed events, pill on the events that have links", async () => {
    vi.mocked(getSoundcloudAvailabilityForEvents).mockImplementationOnce(async (list) => list.map((e) => e.id === "with-audio"));
    await renderPage([makeEvent("with-audio", ["techno"], FUTURE), makeEvent("without", ["techno"], FUTURE)]);
    expect(getSoundcloudAvailabilityForEvents).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Audio")).toHaveLength(1);
    expect(screen.getByLabelText("Go to audio links for Event with-audio")).toBeTruthy();
  });

  it("renders the H1 and a short intro naming only Techno — no subgenres", async () => {
    await renderPage([]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Techno Events in Copenhagen");
    expect(screen.getByText(/every published event tagged Techno\./)).toBeTruthy();
    expect(screen.queryByText(/Melodic Techno|Minimal Techno|Industrial/)).toBeNull();
    expect(metadata.description).not.toMatch(/industrial|melodic|minimal/i);
  });

  it("lists only upcoming events with Techno as one of their genres, in date order — no subgenres", async () => {
    await renderPage([
      makeEvent("later-techno", ["techno"], "2099-02-01T20:00:00.000Z"),
      makeEvent("techno-industrial", ["techno", "industrial"], "2099-01-15T20:00:00.000Z"),
      makeEvent("house-techno", ["house", "techno"], FUTURE),
      makeEvent("melodic", ["house", "melodic-techno"], FUTURE),
      makeEvent("minimal", ["minimal-techno"], FUTURE),
      makeEvent("industrial", ["industrial"], FUTURE),
      makeEvent("hard", ["hard-techno"], FUTURE),
      makeEvent("house", ["house"], FUTURE),
      makeEvent("none", [], FUTURE),
      makeEvent("past", ["techno"], "2020-01-01T20:00:00.000Z"),
    ]);
    const titles = screen.getAllByRole("listitem").map((li) => within(li).getAllByRole("link")[0].textContent?.replace(/→$/, "").trim());
    expect(titles).toEqual(["Event house-techno", "Event techno-industrial", "Event later-techno"]);
    for (const hidden of ["melodic", "minimal", "industrial", "hard", "house", "none", "past"]) {
      expect(screen.queryByText(`Event ${hidden}`), hidden).toBeNull();
    }
  });

  it("lists exactly what the homepage Techno filter matches, for every genre combination", async () => {
    const all = GENRES.flatMap((a, i) => GENRES.slice(i).map((b) => makeEvent(`${a.slug}+${b.slug}`, a.slug === b.slug ? [a.slug] : [a.slug, b.slug], FUTURE)));
    await renderPage(all);
    const listed = screen.getAllByRole("listitem").length;
    expect(listed).toBe(all.filter((e) => matchesGenreFilter(e.subgenres, "techno")).length);
    expect(listed).toBe(all.filter((e) => e.subgenres.includes("techno")).length);
  });

  it("uses the existing event row (event-detail and venue links per event)", async () => {
    await renderPage([makeEvent("a", ["techno"], FUTURE)]);
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("link", { name: /Event a/ }).getAttribute("href")).toBe("/events/event-a");
    expect(within(row).getByRole("link", { name: "Test Venue" }).getAttribute("href")).toBe("/venues/test-venue");
  });

  it("only ever reads published events (getPublishedEventsWithVenue)", async () => {
    await renderPage([]);
    expect(getPublishedEventsWithVenue).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state, not an empty list, when no upcoming techno event exists", async () => {
    await renderPage([makeEvent("past", ["techno"], "2020-01-01T20:00:00.000Z"), makeEvent("house", ["house"], FUTURE)]);
    expect(screen.getByText("No upcoming techno events listed")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Techno Events in Copenhagen");
  });
});
