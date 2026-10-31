// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { EventWithVenue } from "@/lib/queries";
import { GENRES, INDEXABLE_GENRE_PAGES, genrePagePath, matchesGenreSelection, parentOf, type GenreSlug } from "@/lib/taxonomy";
import { GENRE_PAGE_CONTENT } from "@/lib/genrePages";
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
const { default: GenrePage, generateMetadata, generateStaticParams } = pageModule;
const props = (slug: string) => ({ params: Promise.resolve({ slug }) }) as unknown as PageProps<"/genres/[slug]">;
const metadataFor = (slug: string) => generateMetadata(props(slug));
const metadata = await metadataFor("techno");

async function renderPage(events: EventWithVenue[], slug = "techno") {
  vi.mocked(getPublishedEventsWithVenue).mockResolvedValue(events);
  render(await GenrePage(props(slug)));
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("/genres/techno — metadata (via the shared /genres/[slug] route)", () => {
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

  // SEO QA (genre system revision, 2026-10-30): the page stays indexable —
  // no robots metadata, so the default "index, follow" applies (the root
  // layout sets none either; see layout.tsx) — and its canonical is the
  // allowlisted page path itself.
  it("stays indexable (no robots override) and its canonical is the allowlisted genre page path", () => {
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe(genrePagePath("techno"));
    expect(INDEXABLE_GENRE_PAGES).toEqual(["techno", "house", "trance"]);
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

  // Genre system revision (2026-10-24, intended change from #161): Techno is
  // a main genre, so its page includes every techno subgenre — but never the
  // standalone Industrial genre.
  it("renders the H1 and an intro naming Techno and its subgenres, straight from the taxonomy — not Industrial", async () => {
    await renderPage([]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Techno Events in Copenhagen");
    expect(
      screen.getByText(/every published event tagged Techno, Hard Techno, Industrial Techno, Hypnotic Techno, Melodic Techno or Minimal Techno\./),
    ).toBeTruthy();
    expect(metadata.description).toMatch(/techno subgenre/);
  });

  it("lists upcoming events tagged Techno or a techno subgenre, each once, in date order — not Industrial-only events", async () => {
    await renderPage([
      makeEvent("later-techno", ["techno"], "2099-02-01T20:00:00.000Z"),
      makeEvent("techno-industrial", ["techno", "industrial"], "2099-01-15T20:00:00.000Z"),
      makeEvent("two-subgenres", ["hard-techno", "hypnotic-techno"], "2099-01-10T20:00:00.000Z"),
      makeEvent("house-techno", ["house", "techno"], FUTURE),
      makeEvent("melodic", ["house", "melodic-techno"], FUTURE),
      makeEvent("minimal", ["minimal-techno"], FUTURE),
      makeEvent("industrial-techno", ["industrial-techno"], FUTURE),
      makeEvent("industrial", ["industrial"], FUTURE),
      makeEvent("hardcore", ["hardcore"], FUTURE),
      makeEvent("house", ["house"], FUTURE),
      makeEvent("none", [], FUTURE),
      makeEvent("past", ["techno"], "2020-01-01T20:00:00.000Z"),
    ]);
    const titles = screen.getAllByRole("listitem").map((li) => within(li).getAllByRole("link")[0].textContent?.replace(/→$/, "").trim());
    expect(titles).toEqual([
      "Event house-techno",
      "Event melodic",
      "Event minimal",
      "Event industrial-techno",
      "Event two-subgenres",
      "Event techno-industrial",
      "Event later-techno",
    ]);
    for (const hidden of ["industrial", "hardcore", "house", "none", "past"]) {
      expect(screen.queryByText(`Event ${hidden}`), hidden).toBeNull();
    }
  });

  it("lists exactly what the homepage Techno filter matches, for every genre combination", async () => {
    const all = GENRES.flatMap((a, i) => GENRES.slice(i).map((b) => makeEvent(`${a.slug}+${b.slug}`, a.slug === b.slug ? [a.slug] : [a.slug, b.slug], FUTURE)));
    await renderPage(all);
    const listed = screen.getAllByRole("listitem").length;
    expect(listed).toBe(all.filter((e) => matchesGenreSelection(e.subgenres, "techno")).length);
    expect(listed).toBe(all.filter((e) => e.subgenres.some((g) => g === "techno" || parentOf(g) === "techno")).length);
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

  it("with zero events at all it still renders the full page (H1, intro, empty state) — never a 404", async () => {
    await renderPage([]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Techno Events in Copenhagen");
    expect(screen.getByText(/every published event tagged Techno, Hard Techno/)).toBeTruthy();
    expect(screen.getByText("No upcoming techno events listed")).toBeTruthy();
  });

  it("shows the empty state, not an empty list, when no upcoming techno event exists", async () => {
    await renderPage([makeEvent("past", ["techno"], "2020-01-01T20:00:00.000Z"), makeEvent("house", ["house"], FUTURE)]);
    expect(screen.getByText("No upcoming techno events listed")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Techno Events in Copenhagen");
  });
});

// Shared genre route (2026-10-31): Techno, House and Trance from one
// implementation; every other slug is a 404.
describe("/genres/[slug] — shared route", () => {
  const FUTURE = "2099-01-01T20:00:00.000Z";

  it("generates exactly the allowlisted slugs, and nothing else (dynamicParams = false)", () => {
    expect(generateStaticParams()).toEqual([{ slug: "techno" }, { slug: "house" }, { slug: "trance" }]);
    expect(pageModule.dynamicParams).toBe(false);
  });

  it("each page has its own H1, title, description, self-canonical and Open Graph/Twitter metadata", async () => {
    const pages = await Promise.all(INDEXABLE_GENRE_PAGES.map(async (g) => ({ g, m: await metadataFor(g) })));
    const expected = {
      techno: { title: "Techno Events in Copenhagen | Electronic CPH", canonical: "/genres/techno" },
      house: { title: "House Music Events in Copenhagen | Electronic CPH", canonical: "/genres/house" },
      trance: { title: "Trance & Psytrance Events in Copenhagen | Electronic CPH", canonical: "/genres/trance" },
    } as const;
    for (const { g, m } of pages) {
      expect(m.title, g).toEqual({ absolute: expected[g].title });
      expect(m.alternates?.canonical, g).toBe(expected[g].canonical);
      expect(m.robots, g).toBeUndefined();
      expect((m.description as string).length, g).toBeLessThanOrEqual(160);
      expect(m.openGraph, g).toMatchObject({ type: "website", siteName: "Electronic CPH", url: expected[g].canonical, title: `${GENRE_PAGE_CONTENT[g].h1} — Electronic CPH`, description: m.description });
      expect(m.twitter, g).toMatchObject({ card: "summary", title: `${GENRE_PAGE_CONTENT[g].h1} — Electronic CPH`, description: m.description });
    }
    for (const key of ["h1", "seoTitle", "description"] as const) {
      expect(new Set(INDEXABLE_GENRE_PAGES.map((g) => GENRE_PAGE_CONTENT[g][key])).size, key).toBe(INDEXABLE_GENRE_PAGES.length);
    }
  });

  it("an unknown or unapproved slug is a 404 (notFound) with no metadata", async () => {
    for (const slug of ["industrial", "hard-techno", "psytrance", "uk-garage", "bass-breaks", "nope"]) {
      await expect(GenrePage(props(slug))).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
      expect(await metadataFor(slug)).toEqual({});
    }
  });

  it("/genres/house lists House and its subgenres, each once, in date order — not Disco or Techno-only events", async () => {
    await renderPage(
      [
        makeEvent("deep", ["deep-house"], "2099-01-05T20:00:00.000Z"),
        makeEvent("house-techno", ["house", "techno"], "2099-01-02T20:00:00.000Z"),
        makeEvent("two-subgenres", ["tech-house", "afro-house"], "2099-01-03T20:00:00.000Z"),
        makeEvent("disco", ["disco"], FUTURE),
        makeEvent("techno", ["techno"], FUTURE),
      ],
      "house",
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("House Music Events in Copenhagen");
    expect(screen.getByText(/every published event tagged House, Deep House, Tech House, Progressive House or Afro House\./)).toBeTruthy();
    const titles = screen.getAllByRole("listitem").map((li) => within(li).getAllByRole("link")[0].textContent?.replace(/→$/, "").trim());
    expect(titles).toEqual(["Event house-techno", "Event two-subgenres", "Event deep"]);
  });

  it("/genres/trance lists Trance and Psytrance — and nothing else", async () => {
    await renderPage([makeEvent("psy", ["psytrance"], FUTURE), makeEvent("trance", ["trance", "techno"], FUTURE), makeEvent("hardstyle", ["hardstyle"], FUTURE)], "trance");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Trance Events in Copenhagen");
    expect(screen.getByText(/every published event tagged Trance or Psytrance\./)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("Event hardstyle")).toBeNull();
  });

  it("each page lists exactly what the homepage filter matches for that genre, for every genre combination", async () => {
    const all = GENRES.flatMap((a, i) => GENRES.slice(i).map((b) => makeEvent(`${a.slug}+${b.slug}`, a.slug === b.slug ? [a.slug] : [a.slug, b.slug], FUTURE)));
    for (const g of INDEXABLE_GENRE_PAGES) {
      cleanup();
      await renderPage(all, g);
      expect(screen.getAllByRole("listitem").length, g).toBe(all.filter((e) => matchesGenreSelection(e.subgenres, g)).length);
    }
  });

  it("renders the full page with an empty state when a genre has no upcoming events — never a 404", async () => {
    for (const g of INDEXABLE_GENRE_PAGES) {
      cleanup();
      await renderPage([], g);
      expect(screen.getByRole("heading", { level: 1 }).textContent, g).toBe(GENRE_PAGE_CONTENT[g].h1);
      expect(screen.getByText(`No upcoming ${GENRE_PAGE_CONTENT[g].eventsNoun} listed`)).toBeTruthy();
    }
  });

  it("links to the other approved genre pages, and only to them", async () => {
    await renderPage([], "house");
    const genreLinks = screen.getAllByRole("link").map((a) => a.getAttribute("href")).filter((h) => h?.startsWith("/genres/"));
    expect(genreLinks).toEqual(["/genres/techno", "/genres/trance"]);
  });
});
