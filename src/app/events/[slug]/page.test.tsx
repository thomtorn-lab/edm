// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EventWithVenue } from "@/lib/queries";
import type { GenreSlug } from "@/lib/taxonomy";

const VENUE = {
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
};

function makeEvent(overrides: Partial<EventWithVenue> = {}): EventWithVenue {
  return {
    id: "e-1",
    title: "Test Event",
    slug: "test-event",
    description: null,
    artists: [],
    startDatetime: "2026-08-10T20:00:00.000Z",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: VENUE.id,
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
    venue: VENUE,
    ...overrides,
  };
}

vi.mock("@/lib/queries", () => ({
  getEventBySlugWithVenue: vi.fn(),
  getSourceEventLinksForEvent: vi.fn(),
  getEventYoutubePreview: vi.fn(),
  getSoundcloudLinksForLineup: vi.fn(),
}));

const { getEventBySlugWithVenue, getSourceEventLinksForEvent, getEventYoutubePreview, getSoundcloudLinksForLineup } =
  await import("@/lib/queries");
const { default: EventDetailPage } = await import("./page");

type SourceLinkRow = { sourceId: string; sourceUrl: string; role: string };

/**
 * `sourceLinks` stands in for the event's real `source_event_links` rows.
 * The detail page no longer renders public provenance from them (removed
 * 2026-10-16); tests still supply them to prove discovery rows never leak
 * into the page. Defaults to none.
 *
 * getEventYoutubePreview defaults to null (no video: no override and no
 * cached YouTube Artist Preview match) — none of the tests in this file are about that
 * feature, so it stays off unless a test opts in. getSoundcloudLinksForLineup
 * likewise defaults to no links.
 */
async function renderPage(
  event: EventWithVenue,
  sourceLinks: SourceLinkRow[] = [],
  soundcloudLinks: { name: string; url: string }[] = [],
) {
  vi.mocked(getEventBySlugWithVenue).mockResolvedValue(event);
  vi.mocked(getSourceEventLinksForEvent).mockResolvedValue(sourceLinks);
  vi.mocked(getEventYoutubePreview).mockResolvedValue(null);
  vi.mocked(getSoundcloudLinksForLineup).mockResolvedValue(soundcloudLinks);
  const element = await EventDetailPage({ params: Promise.resolve({ slug: event.slug }) } as never);
  render(element);
}

describe("Event detail page — Source CTA visibility; no public provenance line (removed 2026-10-16)", () => {
  afterEach(cleanup);

  const KULTUNAUT_ROW = { sourceId: "src-kultunaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=2", role: "official" };

  it("official canonical (Hangaren) + secondary discovery match (KultuNaut) -> Official event CTA shown, Source CTA hidden, no Source:/KultuNaut line", async () => {
    await renderPage(
      makeEvent({ officialEventUrl: "https://www.hangaren.dk/events/x", canonicalSourceId: "src-hangaren" }),
      [{ sourceId: "src-hangaren", sourceUrl: "https://www.hangaren.dk/events/x", role: "official" }, KULTUNAUT_ROW],
    );
    expect(screen.getByText(/^Official event/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Source ↗/i })).toBeNull();
    expect(screen.queryByText(/^Sources?:/)).toBeNull();
    expect(screen.queryByRole("link", { name: "KultuNaut" })).toBeNull();
  });

  it("hides the Source CTA when a Tickets link exists, and shows no provenance line even with discovery source_event_links rows", async () => {
    await renderPage(makeEvent({ ticketUrl: "https://billetto.dk/e/x" }), [
      KULTUNAUT_ROW,
      { sourceId: "src-eventbrite", sourceUrl: "https://www.eventbrite.dk/e/example", role: "official" },
    ]);
    expect(screen.getByText(/^Tickets/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Source ↗/i })).toBeNull();
    expect(screen.queryByText(/^Sources?:/)).toBeNull();
    expect(screen.queryByRole("link", { name: "KultuNaut" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Eventbrite" })).toBeNull();
  });

  it("shows Official event + Tickets together, Source CTA hidden, when all three exist", async () => {
    await renderPage(
      makeEvent({
        officialEventUrl: "https://www.hangaren.dk/events/x",
        canonicalSourceId: "src-hangaren",
        ticketUrl: "https://billetto.dk/e/x",
      }),
      [{ sourceId: "src-hangaren", sourceUrl: "https://www.hangaren.dk/events/x", role: "official" }, KULTUNAUT_ROW],
    );
    expect(screen.getByText(/^Official event/i)).toBeTruthy();
    expect(screen.getByText(/^Tickets/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Source ↗/i })).toBeNull();
    expect(screen.queryByText(/^Sources?:/)).toBeNull();
  });

  it("source-only detail page keeps the last-resort Source ↗ CTA, pointing at the event's own URL, with no separate provenance line", async () => {
    const url = "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20137664";
    await renderPage(makeEvent({ officialEventUrl: url, canonicalSourceId: "src-kultunaut" }), [
      { sourceId: "src-kultunaut", sourceUrl: url, role: "official" },
    ]);
    const cta = screen.getByRole("link", { name: /^Source ↗/i });
    expect(cta.getAttribute("href")).toBe(url);
    expect(screen.queryByText(/^Sources?:/)).toBeNull();
    expect(screen.queryByRole("link", { name: "KultuNaut" })).toBeNull();
  });

  it("does not fetch source_event_links for public rendering", async () => {
    vi.mocked(getSourceEventLinksForEvent).mockClear();
    await renderPage(makeEvent({ ticketUrl: "https://billetto.dk/e/x" }), [KULTUNAUT_ROW]);
    expect(getSourceEventLinksForEvent).not.toHaveBeenCalled();
  });

  it("keeps the general sourcing note and its contact link", async () => {
    await renderPage(makeEvent({ officialEventUrl: "https://www.hangaren.dk/events/x", canonicalSourceId: "src-hangaren" }), [
      KULTUNAUT_ROW,
    ]);
    expect(screen.getByText(/Details are drawn from official and verified sources/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "let us know" }).getAttribute("href")).toBe("/contact");
  });
});

describe("Event detail page — FREE badge removed (frontend polish, Round 9)", () => {
  afterEach(cleanup);

  it("never renders a FREE badge, even for a free event with no other links", async () => {
    await renderPage(makeEvent({ priceFrom: 0, ticketUrl: null, residentAdvisorUrl: null, officialEventUrl: null }));
    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.queryByText("Links")).toBeNull();
  });

  it("never renders a FREE badge for a free event that also has an official event link", async () => {
    await renderPage(
      makeEvent({
        priceFrom: 0,
        ticketUrl: null,
        residentAdvisorUrl: null,
        officialEventUrl: "https://venue.example.com/event",
      }),
    );
    expect(screen.queryByText("Free")).toBeNull();
    expect(screen.getByText(/Official event/i)).toBeTruthy();
  });

  it("shows no empty Links heading when the event has no external links", async () => {
    await renderPage(makeEvent({ ticketUrl: null, residentAdvisorUrl: null, officialEventUrl: null }));
    expect(screen.queryByText("Links")).toBeNull();
  });

  it("shows no '+1' overnight annotation next to the end time", async () => {
    await renderPage(
      // 22:00 CEST -> 06:00 CEST next day.
      makeEvent({ startDatetime: "2026-08-10T20:00:00.000Z", endDatetime: "2026-08-11T04:00:00.000Z" }),
    );
    expect(screen.getByText(/22:00/).closest("dd")?.textContent).not.toMatch(/\+1/);
    expect(screen.getByText(/22:00/).closest("dd")?.textContent).toContain("06:00");
  });
});

describe("Event detail page — clickability affordance (Round 13: brighten + underline, non-purple)", () => {
  afterEach(cleanup);

  it("gives the venue link a brighten + subtle underline on hover/focus, no purple color change", async () => {
    await renderPage(makeEvent());
    const venueLink = screen.getByRole("link", { name: "Test Venue" });
    const classes = venueLink.className.split(/\s+/);
    expect(venueLink.getAttribute("href")).toBe("/venues/test-venue");
    // Matches EventRow's venue-link treatment: brighten toward text-primary
    // plus a decoration-color-driven underline reveal, never the purple
    // accent token (Round 13 supersedes the old purple-hover behaviour).
    expect(classes).toContain("hover:text-text-primary");
    expect(classes).toContain("focus-visible:text-text-primary");
    expect(classes).toContain("hover:decoration-current");
    expect(classes).toContain("focus-visible:decoration-current");
    expect(classes).not.toContain("hover:text-accent");
    expect(classes).not.toContain("focus-visible:text-accent");
    expect(classes).not.toContain("hover:text-accent-strong");
    expect(classes).not.toContain("focus-visible:text-accent-strong");
    // The visible venue name text is a direct child of the hover-colored
    // link, not nested in a separately-colored span.
    expect(venueLink.children.length).toBe(0);
    expect(venueLink.textContent).toBe("Test Venue");
  });

  it("does not turn the event title into a link to itself", async () => {
    await renderPage(makeEvent());
    const heading = screen.getByRole("heading", { level: 1, name: "Test Event" });
    expect(heading.tagName).toBe("H1");
    expect(heading.querySelector("a")).toBeNull();
  });
});

describe("Event detail page — sold-out hides Tickets (public link-integrity rule, 2026-09-26)", () => {
  afterEach(cleanup);

  it("normal event + ticket URL -> Tickets shown", async () => {
    await renderPage(makeEvent({ ticketUrl: "https://billetto.dk/e/x", soldOut: false }));
    expect(screen.getByRole("link", { name: /^Tickets/i })).toBeTruthy();
  });

  it("sold-out event + ticket URL -> Tickets hidden", async () => {
    await renderPage(makeEvent({ ticketUrl: "https://billetto.dk/e/x", soldOut: true }));
    expect(screen.queryByText(/^Tickets/i)).toBeNull();
  });

  it("sold-out + Official event -> Official event shown and PRIMARY (filled accent)", async () => {
    await renderPage(
      makeEvent({ officialEventUrl: "https://venue.example.com/event", ticketUrl: "https://billetto.dk/e/x", soldOut: true }),
    );
    expect(screen.queryByText(/^Tickets/i)).toBeNull();
    const officialEvent = screen.getByRole("link", { name: /^Official event/i });
    expect(officialEvent.className).toContain("bg-accent");
    expect(officialEvent.className).toContain("text-accent-on");
  });

  it("sold-out + no Official event -> no primary CTA at all", async () => {
    await renderPage(makeEvent({ officialEventUrl: null, ticketUrl: "https://billetto.dk/e/x", facebookUrl: null, soldOut: true }));
    expect(screen.queryByText(/^Tickets/i)).toBeNull();
    expect(screen.queryByText(/^Official event/i)).toBeNull();
  });

  it("sold-out officialEventUrl classified as ticketing role (e.g. Billetto) -> suppressed entirely, not relabeled Source or Official event", async () => {
    await renderPage(
      makeEvent({ officialEventUrl: "https://billetto.dk/e/x", canonicalSourceId: "src-billetto", soldOut: true }),
    );
    expect(screen.queryByText(/^Tickets/i)).toBeNull();
    expect(screen.queryByText(/^Official event/i)).toBeNull();
    expect(screen.queryByText(/^Source/i)).toBeNull();
  });

  it("sold-out does not mutate the stored event data (ticketUrl/officialEventUrl still present on the input object)", async () => {
    const input = makeEvent({
      officialEventUrl: "https://venue.example.com/event",
      ticketUrl: "https://billetto.dk/e/x",
      soldOut: true,
    });
    const snapshot = JSON.parse(JSON.stringify(input));
    await renderPage(input);
    expect(input).toEqual(snapshot);
  });
});

describe("Event detail page — three-level text hierarchy (Round 18: new secondary-strong grey; superseded for the PRIMARY CTA by the event-detail CTA hierarchy work, 2026-09-26 — the secondary-strong grey now applies only to the SECONDARY CTA, since the primary CTA gets its own filled-accent treatment instead, see the dedicated CTA-hierarchy describe block above)", () => {
  afterEach(cleanup);

  it("keeps the SECONDARY CTA on the existing secondary-strong grey", async () => {
    await renderPage(
      makeEvent({
        officialEventUrl: "https://venue.example.com/event",
        ticketUrl: "https://billetto.dk/e/x",
      }),
    );
    // Tickets is PRIMARY here (verified ticket destination), Official event
    // is SECONDARY — only the secondary CTA keeps the old uniform grey.
    const officialEvent = screen.getByText(/Official event/i);
    expect(officialEvent.className).toContain("text-text-secondary-strong");
  });
});

describe("Event detail page — eyebrow + neutral H1 preserved (Round 19)", () => {
  afterEach(cleanup);

  it("keeps the purple EVENT eyebrow above a neutral/white H1 (detail pages keep this pattern)", async () => {
    await renderPage(makeEvent());
    const eyebrow = screen.getByText("Event");
    expect(eyebrow.className).toContain("text-accent");
    const heading = screen.getByRole("heading", { level: 1, name: "Test Event" });
    expect(heading.className).toContain("text-text-primary");
    expect(heading.className).not.toContain("text-accent");
  });
});

describe("Event detail page — public/internal status separation (event lifecycle/status handling, 2026-08-28: dateChanged is now the public Rescheduled signal; timeChanged alone stays internal-only)", () => {
  afterEach(cleanup);

  it("shows no status text for a normal event", async () => {
    await renderPage(makeEvent());
    expect(screen.queryByText(/Cancelled/i)).toBeNull();
    expect(screen.queryByText(/Sold out/i)).toBeNull();
    expect(screen.queryByText(/Rescheduled/i)).toBeNull();
    expect(screen.queryByText(/Postponed/i)).toBeNull();
  });

  it("dateChanged alone renders the public Rescheduled status", async () => {
    await renderPage(makeEvent({ dateChanged: true }));
    expect(screen.getByText("Rescheduled")).toBeTruthy();
  });

  it("timeChanged alone renders no public status — internal same-day correction only", async () => {
    await renderPage(makeEvent({ timeChanged: true }));
    expect(screen.queryByText(/Rescheduled/i)).toBeNull();
    expect(screen.queryByText(/Time changed/i)).toBeNull();
  });

  it("dateChanged + timeChanged together render only Rescheduled once", async () => {
    await renderPage(makeEvent({ dateChanged: true, timeChanged: true }));
    expect(screen.getAllByText("Rescheduled")).toHaveLength(1);
    expect(screen.queryByText(/Time changed/i)).toBeNull();
  });

  it("cancelled renders no public badge (admin unpublish/cancellation safety, 2026-09-06) — a cancelled event is taken down entirely via admin unpublish, never shown live with a badge", async () => {
    await renderPage(makeEvent({ cancelled: true }));
    expect(screen.queryByText(/Cancelled/i)).toBeNull();
  });

  it("soldOut still renders SOLD OUT", async () => {
    await renderPage(makeEvent({ soldOut: true }));
    expect(screen.getByText("Sold out")).toBeTruthy();
  });

  it("postponed renders POSTPONED", async () => {
    await renderPage(makeEvent({ postponed: true }));
    expect(screen.getByText("Postponed")).toBeTruthy();
  });

  it("cancelled + dateChanged: cancelled contributes no badge, Rescheduled still renders (cancelled no longer suppresses it)", async () => {
    await renderPage(makeEvent({ cancelled: true, dateChanged: true, timeChanged: true }));
    expect(screen.queryByText(/Cancelled/i)).toBeNull();
    expect(screen.getByText("Rescheduled")).toBeTruthy();
  });

  it("soldOut + dateChanged shows both SOLD OUT and RESCHEDULED", async () => {
    await renderPage(makeEvent({ soldOut: true, dateChanged: true, timeChanged: true }));
    expect(screen.getByText("Sold out")).toBeTruthy();
    expect(screen.getByText("Rescheduled")).toBeTruthy();
  });
});

describe("Event detail page — sub-venue title cleanup (Pumpehuset Byhaven / Culture Box rooms)", () => {
  afterEach(cleanup);

  it("shows the clean title (no Byhaven prefix) and Byhaven as secondary venue context", async () => {
    await renderPage(
      makeEvent({
        title: "Byhaven: Love.Rave",
        venue: { ...VENUE, name: "Pumpehuset", slug: "pumpehuset" },
      }),
    );
    expect(screen.getByRole("heading", { level: 1, name: "Love.Rave" })).toBeTruthy();
    expect(screen.queryByText(/Byhaven: Love\.Rave/)).toBeNull();
    const venueLink = screen.getByRole("link", { name: "Pumpehuset" });
    expect(venueLink.closest("dd")?.textContent).toContain("Byhaven");
  });

  it("shows a clean, room-prefix-free title for a Culture Box two-room event", async () => {
    await renderPage(
      makeEvent({
        title: "Black Box: TECHNO SPECIAL · Red Box: HOUSE SPECIAL",
        description: "Black Box\nDJ One, DJ Two\n\nRed Box\nDJ Three, DJ Four",
        venue: { ...VENUE, name: "Culture Box", slug: "culture-box" },
      }),
    );
    expect(screen.getByRole("heading", { level: 1, name: "TECHNO SPECIAL · HOUSE SPECIAL" })).toBeTruthy();
    expect(screen.queryByText(/Black Box:/)).toBeNull();
    // Room-specific lineup breakdown stays fully visible in the About section.
    expect(screen.getByText(/DJ One, DJ Two/)).toBeTruthy();
    expect(screen.getByText(/DJ Three, DJ Four/)).toBeTruthy();
  });

  it("shows no secondary venue context for a Pumpehuset event outside Byhaven", async () => {
    await renderPage(makeEvent({ title: "WITCHZ", venue: { ...VENUE, name: "Pumpehuset", slug: "pumpehuset" } }));
    const venueLink = screen.getByRole("link", { name: "Pumpehuset" });
    expect(venueLink.closest("dd")?.textContent).not.toContain("Byhaven");
  });
});

describe("Event detail page — graceful degradation for sparse/missing metadata", () => {
  afterEach(cleanup);

  it("renders no GENRE label at all when the event has no resolved genre", async () => {
    await renderPage(makeEvent({ subgenres: [] }));
    expect(screen.queryByText("Genre")).toBeNull();
  });

  it("renders the GENRE label with an Electronic / Other chip for a genuinely-classified Other event, distinct from unknown/missing genre", async () => {
    await renderPage(makeEvent({ primaryGenre: "electronic-other", subgenres: ["electronic-other"] }));
    expect(screen.getByText("Genre")).toBeTruthy();
    expect(screen.getByText("Electronic / Other")).toBeTruthy();
  });

  it("renders a real, non-Other genre normally (regression: the conditional wrap must not hide genuine genre chips)", async () => {
    await renderPage(makeEvent({ subgenres: ["drum-and-bass"] }));
    expect(screen.getByText("Genre")).toBeTruthy();
    expect(screen.getByText("Drum & Bass")).toBeTruthy();
  });

  it("renders Deep House verbatim, not the broader House (genre display integrity audit, 2026-09-11)", async () => {
    await renderPage(makeEvent({ primaryGenre: "deep-house", subgenres: ["deep-house"] }));
    expect(screen.getByText("Deep House")).toBeTruthy();
    expect(screen.queryByText("House")).toBeNull();
  });

  it("renders Melodic Techno verbatim, not the broader Techno", async () => {
    await renderPage(makeEvent({ primaryGenre: "melodic-techno", subgenres: ["melodic-techno"] }));
    expect(screen.getByText("Melodic Techno")).toBeTruthy();
    expect(screen.queryByText("Techno")).toBeNull();
  });

  it("renders Industrial verbatim, not Techno or Hard Techno", async () => {
    await renderPage(makeEvent({ primaryGenre: "industrial", subgenres: ["industrial"] }));
    expect(screen.getByText("Industrial")).toBeTruthy();
    expect(screen.queryByText("Techno")).toBeNull();
    expect(screen.queryByText("Hard Techno")).toBeNull();
  });

  it("displays two genres in PRIMARY, SECONDARY order (max-two-genres-per-event, 2026-10-05)", async () => {
    await renderPage(makeEvent({ primaryGenre: "techno", subgenres: ["techno", "melodic-techno"] }));
    const techno = screen.getByText("Techno");
    const melodicTechno = screen.getByText("Melodic Techno");
    expect(techno).toBeTruthy();
    expect(melodicTechno).toBeTruthy();
    expect(techno.compareDocumentPosition(melodicTechno) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links the Techno genre tag to /genres/techno; subgenre tags stay plain (genre landing page pilot, 2026-10-09)", async () => {
    await renderPage(makeEvent({ primaryGenre: "techno", subgenres: ["techno", "melodic-techno"] }));
    expect(screen.getByRole("link", { name: "Techno" }).getAttribute("href")).toBe("/genres/techno");
    expect(screen.getByText("Melodic Techno").tagName).toBe("SPAN");
    expect(screen.queryByRole("link", { name: "Melodic Techno" })).toBeNull();
  });

  it("never shows the same genre twice, even if subgenres repeats a slug", async () => {
    await renderPage(makeEvent({ primaryGenre: "techno", subgenres: ["techno", "techno"] }));
    expect(screen.getAllByText("Techno")).toHaveLength(1);
  });

  it("caps the genre display at two even if a stored event somehow carries more than two subgenres", async () => {
    await renderPage(makeEvent({ primaryGenre: "techno", subgenres: ["techno", "melodic-techno", "house"] }));
    expect(screen.getByText("Techno")).toBeTruthy();
    expect(screen.getByText("Melodic Techno")).toBeTruthy();
    expect(screen.queryByText("House")).toBeNull();
  });

  it("renders no empty About heading/block when the event has no description", async () => {
    await renderPage(makeEvent({ description: null }));
    expect(screen.queryByText("About")).toBeNull();
  });

  it("still renders the About block when a description is present", async () => {
    await renderPage(makeEvent({ description: "A real description." }));
    expect(screen.getByText("About")).toBeTruthy();
    expect(screen.getByText("A real description.")).toBeTruthy();
  });

  it("labels a practical-only text 'Practical information' and keeps it out of the JSON-LD description", async () => {
    const text = "In Store and Lille VEGA the cloakroom must always be used for safety reasons. A cloakroom fee is charged.";
    await renderPage(makeEvent({ description: text, aboutKind: "practical" }));
    expect(screen.getByRole("heading", { level: 2, name: "Practical information" })).toBeTruthy();
    expect(screen.queryByText("About")).toBeNull();
    expect(screen.getByText(text)).toBeTruthy();
    const jsonLd = JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(jsonLd.description).toBeUndefined();
  });

  it("puts an About text (in its own language, unchanged) in the JSON-LD description", async () => {
    await renderPage(makeEvent({ description: "En rigtig beskrivelse af aftenen.", aboutKind: "about" }));
    const jsonLd = JSON.parse(document.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(jsonLd.description).toBe("En rigtig beskrivelse af aftenen.");
  });

  it("structures the About text: section headings, separate paragraphs and labelled links, never raw markup", async () => {
    await renderPage(
      makeEvent({
        description:
          "PRACTICAL INFORMATION\nDoors open at 23:00 and the night runs until five in the morning, with a cloakroom.\n\nListen: https://soundcloud.com/pinkmonkey",
      }),
    );
    expect(screen.getByRole("heading", { level: 3, name: "PRACTICAL INFORMATION" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /SoundCloud/ }).getAttribute("href")).toBe("https://soundcloud.com/pinkmonkey");
  });

  it("a maximally sparse event (title + date/time + venue only, no genre/description/links/artists) renders its core fields with no empty optional sections", async () => {
    await renderPage(
      makeEvent({
        subgenres: [],
        description: null,
        artists: [],
        ticketUrl: null,
        officialEventUrl: null,
        facebookUrl: null,
        residentAdvisorUrl: null,
        otherSourceUrls: [],
        endDatetime: null,
      }),
    );
    // Core fields always present.
    expect(screen.getByRole("heading", { level: 1, name: "Test Event" })).toBeTruthy();
    expect(screen.getByText("Date & time")).toBeTruthy();
    expect(screen.getByText("Venue")).toBeTruthy();
    // No optional section renders empty.
    expect(screen.queryByText("Genre")).toBeNull();
    expect(screen.queryByText("About")).toBeNull();
    expect(screen.queryByText("Links")).toBeNull();
  });

  it("shows the artist lineup on a sparse event even when description is absent (lineup and description are independent)", async () => {
    await renderPage(
      makeEvent({
        title: "Test Event",
        artists: ["DJ Alpha", "DJ Beta"],
        description: null,
        subgenres: [],
      }),
    );
    expect(screen.getByText("DJ Alpha / DJ Beta")).toBeTruthy();
    expect(screen.queryByText("About")).toBeNull();
  });
});

describe("Event detail page — suppress redundant artist preview when the title already names the lineup", () => {
  afterEach(cleanup);

  it("hides the grey artist line for a real Culture Box two-room event whose cleaned title already names every artist", async () => {
    await renderPage(
      makeEvent({
        title:
          "Black Box: TAXMAN, DWONJI, BOBBY 6 KILLA, HDN, DJ BREAKFAST, MAXI MO, L.A.D.J · Red Box: FIA2THEFLOOR, AMITTET, TINKI, DELFF",
        artists: ["TAXMAN", "DWONJI", "BOBBY 6 KILLA", "HDN", "DJ BREAKFAST", "MAXI MO", "L.A.D.J", "FIA2THEFLOOR", "AMITTET", "TINKI", "DELFF"],
        venue: { ...VENUE, name: "Culture Box", slug: "culture-box" },
      }),
    );
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.queryByText(/TAXMAN \/ DWONJI/)).toBeNull();
  });

  it("still shows the grey artist line when the title is a showcase name that adds no artist information", async () => {
    await renderPage(
      makeEvent({
        title: "HYGGELIT SHOWCASE",
        artists: ["SOPHIE VAN HAYDEN", "NAIVA", "ONSBERG"],
        venue: { ...VENUE, name: "Culture Box", slug: "culture-box" },
      }),
    );
    expect(screen.getByText("SOPHIE VAN HAYDEN / NAIVA / ONSBERG")).toBeTruthy();
  });

  it("still shows the grey artist line when only some artists are named in the title (partial overlap)", async () => {
    await renderPage(
      makeEvent({
        title: "Black Box: STELLAR FOUNTAIN · Red Box: GALATIUS, KEVIN FLOOR",
        artists: ["ERICH VON KOLLAR", "MSW COLLECTIVE", "GÆO", "GALATIUS", "KEVIN FLOOR"],
        venue: { ...VENUE, name: "Culture Box", slug: "culture-box" },
      }),
    );
    expect(screen.getByText(/ERICH VON KOLLAR/)).toBeTruthy();
  });

  it("hides the grey artist line when the same artist name repeats across both rooms (real Culture Box shape)", async () => {
    await renderPage(
      makeEvent({
        title: "Black Box: Shaktu, Meoko, COSMINA, JOSEFINA TAPIA, ANA KARLA · Red Box: Shaktu, Meoko, YOON, CHRISTINA EVANGELISTA",
        artists: ["Shaktu", "Meoko", "COSMINA", "JOSEFINA TAPIA", "ANA KARLA", "YOON", "CHRISTINA EVANGELISTA"],
        venue: { ...VENUE, name: "Culture Box", slug: "culture-box" },
      }),
    );
    expect(screen.queryByText(/Shaktu \/ Meoko/)).toBeNull();
  });

  it("still shows the grey artist line for a non-Culture-Box event whose title never names the artists (no regression)", async () => {
    await renderPage(makeEvent({ title: "Test Event", artists: ["DJ Alpha", "DJ Beta"] }));
    expect(screen.getByText("DJ Alpha / DJ Beta")).toBeTruthy();
  });
});

describe("Event detail page — Share button (2026-09-13; relocated below Genre, 2026-09-13 follow-up; text field removed, 2026-09-13 follow-up)", () => {
  afterEach(() => {
    cleanup();
    Object.defineProperty(window.navigator, "share", { value: undefined, configurable: true, writable: true });
  });

  it("1. Share is no longer part of the Add to calendar action row", async () => {
    await renderPage(makeEvent());
    const calendarSection = screen.getByText("Add to calendar").closest("div");
    const shareButton = screen.getByRole("button", { name: /^Share /i });
    expect(calendarSection?.contains(shareButton)).toBe(false);
  });

  it("2. order (event-page action layout, 2026-10-17): Genre -> primary CTA -> Add to calendar -> Share -> About", async () => {
    await renderPage(
      makeEvent({ description: "Some description.", officialEventUrl: "https://venue.example.com/event" }),
    );
    const genreDt = screen.getByText("Genre");
    const officialEventCta = screen.getByText(/^Official event/i);
    const calendarButton = screen.getByRole("button", { name: "Add to calendar" });
    const shareButton = screen.getByRole("button", { name: /^Share /i });
    const aboutHeading = screen.getByText("About");

    expect(genreDt.compareDocumentPosition(officialEventCta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(officialEventCta.compareDocumentPosition(calendarButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(calendarButton.compareDocumentPosition(shareButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shareButton.compareDocumentPosition(aboutHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the primary CTA sits inside the bordered facts block (under Genre, above its lower rule); Share sits outside it, in the secondary row with Add to calendar", async () => {
    await renderPage(makeEvent({ officialEventUrl: "https://venue.example.com/event" }));
    const officialEvent = screen.getByRole("link", { name: /^Official event/i });
    const factsBlock = screen.getByText("Genre").closest("dl")!.parentElement!;
    expect(factsBlock.className).toContain("border-y");
    expect(factsBlock.contains(officialEvent)).toBe(true);
    // The action row is a sibling of the <dl>, never inside it (only dt/dd groups belong there).
    expect(screen.getByText("Genre").closest("dl")!.contains(officialEvent)).toBe(false);

    const shareButton = screen.getByRole("button", { name: /^Share /i });
    const calendarButton = screen.getByRole("button", { name: "Add to calendar" });
    expect(factsBlock.contains(shareButton)).toBe(false);
    expect(officialEvent.parentElement?.contains(shareButton)).toBe(false);
    // ShareButton and AddToCalendar each wrap their <button> in their own
    // "relative inline-block" div, so the row is two levels up.
    const secondaryRow = calendarButton.parentElement!.parentElement!;
    expect(secondaryRow.contains(shareButton)).toBe(true);
  });

  it("Share still renders even when the event has no external links at all (unconditional, unlike Tickets/Official event)", async () => {
    await renderPage(
      makeEvent({ officialEventUrl: null, ticketUrl: null, facebookUrl: null, residentAdvisorUrl: null, otherSourceUrls: [] }),
    );
    expect(screen.getByRole("button", { name: /^Share /i })).toBeTruthy();
  });

  it("3. the Share button's accessible name contains the event's (cleaned) title", async () => {
    await renderPage(makeEvent({ title: "Warehouse Night" }));
    expect(screen.getByRole("button", { name: "Share Warehouse Night" })).toBeTruthy();
  });

  it("4. navigator.share receives exactly the event title and the clean canonical URL — no text field, no query/filter parameters regardless of the event's own slug", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "share", { value: shareMock, configurable: true, writable: true });
    await renderPage(makeEvent({ title: "Warehouse Night", slug: "warehouse-night-2026" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Share /i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(shareMock).toHaveBeenCalledWith({
      title: "Warehouse Night",
      url: "https://www.electroniccph.com/events/warehouse-night-2026",
    });
  });

  it("5. the native share payload contains exactly title/url and never includes the event description/lineup", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "share", { value: shareMock, configurable: true, writable: true });
    await renderPage(
      makeEvent({
        title: "Warehouse Night",
        description: "A long description with lineup details that must never be shared.",
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Share /i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const payload = shareMock.mock.calls[0][0] as ShareData;
    expect(Object.keys(payload).sort()).toEqual(["title", "url"]);
    expect((payload as { text?: string }).text).toBeUndefined();
  });

  it("does not alter the existing Official event/Tickets CTAs, and Add to calendar still offers all three calendars", async () => {
    await renderPage(
      makeEvent({ officialEventUrl: "https://venue.example.com/event", ticketUrl: "https://billetto.dk/e/x" }),
    );
    expect(screen.getByText(/Official event/i)).toBeTruthy();
    expect(screen.getByText(/Tickets/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(screen.getByRole("menuitem", { name: /Google Calendar/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Outlook/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Apple Calendar \/ ICS/i })).toBeTruthy();
  });
});

describe("Event detail page — Apple Calendar / ICS uses a real HTTP endpoint, not a data: URL (mobile fix, 2026-09-13)", () => {
  afterEach(cleanup);

  it("Apple Calendar / ICS points at the real per-event ICS route", async () => {
    await renderPage(makeEvent({ slug: "warehouse-night" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    const icsLink = screen.getByRole("menuitem", { name: /Apple Calendar/i });
    expect(icsLink.getAttribute("href")).toBe("/events/warehouse-night/calendar.ics");
    expect(icsLink.getAttribute("href")).not.toMatch(/^data:/);
    expect(icsLink.getAttribute("download")).toBeNull();
  });

  it("Google Calendar and Outlook links remain unchanged by the ICS fix", async () => {
    await renderPage(makeEvent());
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    const google = screen.getByRole("menuitem", { name: /Google Calendar/i });
    const outlook = screen.getByRole("menuitem", { name: /Outlook/i });
    expect(google.getAttribute("href")).toContain("https://calendar.google.com/calendar/render");
    expect(outlook.getAttribute("href")).toContain("https://outlook.live.com/calendar/0/deeplink/compose");
    expect(google.getAttribute("target")).toBe("_blank");
    expect(outlook.getAttribute("target")).toBe("_blank");
  });
});

describe("Event detail page — multi-day event date-range display", () => {
  afterEach(cleanup);

  it("shows a single full date for a same-day event", async () => {
    await renderPage(makeEvent({ startDatetime: "2026-08-10T18:00:00.000Z", endDatetime: "2026-08-10T21:00:00.000Z" }));
    expect(screen.getByText(/^Monday 10 August 2026/).closest("dd")?.textContent).toMatch(/^Monday 10 August 2026/);
  });

  it("shows the start date only for a normal overnight event ending the next Copenhagen calendar day", async () => {
    await renderPage(makeEvent({ startDatetime: "2026-10-09T20:00:00.000Z", endDatetime: "2026-10-10T04:00:00.000Z" }));
    const ddText = screen.getByText(/^Friday 9 October 2026/).closest("dd")?.textContent ?? "";
    expect(ddText.startsWith("Friday 9 October 2026")).toBe(true);
    expect(ddText).not.toContain("Saturday");
    expect(ddText).not.toContain("Friday 9 October 2026 –");
  });

  it("shows the full date range for a true multi-day event (2+ Copenhagen calendar days later)", async () => {
    await renderPage(makeEvent({ startDatetime: "2026-10-09T20:00:00.000Z", endDatetime: "2026-10-11T03:00:00.000Z" }));
    expect(screen.getByText(/Friday 9 October 2026 – Sunday 11 October 2026/).closest("dd")?.textContent).toMatch(
      /^Friday 9 October 2026 – Sunday 11 October 2026/,
    );
  });

  it("falls back to a single full date when there is no end datetime — never invents an end date", async () => {
    await renderPage(makeEvent({ startDatetime: "2026-10-09T20:00:00.000Z", endDatetime: null }));
    const ddText = screen.getByText(/^Friday 9 October 2026/).closest("dd")?.textContent ?? "";
    expect(ddText.startsWith("Friday 9 October 2026")).toBe(true);
    expect(ddText).not.toContain("Sunday");
    expect(ddText).not.toContain("–");
  });
});

describe("Event detail page — YouTube Artist Preview embed (automated Rule A V1, 2026-09-25)", () => {
  afterEach(cleanup);

  it("renders the embed when a cached accepted match exists", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({
      artistName: "Eric Prydz",
      videoId: "abc123XYZ",
      videoTitle: "Eric Prydz DJ Set",
      channelTitle: "Eric Prydz",
    });
    await renderPage(makeEvent({ artists: ["Eric Prydz"] }));

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc123XYZ");
  });

  it("renders no embed and no placeholder when there is no cached match", async () => {
    await renderPage(makeEvent({ artists: ["Some Unmatched Artist"] }));
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByText(/no preview available/i)).toBeNull();
  });
});

describe("Event detail page — primary/secondary CTA hierarchy (event-detail CTA hierarchy work, 2026-09-26)", () => {
  afterEach(cleanup);

  it("Tickets is PRIMARY (filled accent) and Official event is SECONDARY (outline) when both exist", async () => {
    await renderPage(
      makeEvent({
        officialEventUrl: "https://venue.example.com/event",
        ticketUrl: "https://billetto.dk/e/x",
      }),
    );
    const tickets = screen.getByRole("link", { name: /^Tickets/i });
    const officialEvent = screen.getByRole("link", { name: /^Official event/i });
    expect(tickets.className).toContain("bg-accent");
    expect(tickets.className).toContain("text-accent-on");
    expect(officialEvent.className).not.toContain("bg-accent");
    expect(officialEvent.className).toContain("border-border-strong");
  });

  it("Official event becomes PRIMARY when no verified Tickets link exists", async () => {
    await renderPage(makeEvent({ officialEventUrl: "https://venue.example.com/event", ticketUrl: null }));
    const officialEvent = screen.getByRole("link", { name: /^Official event/i });
    expect(officialEvent.className).toContain("bg-accent");
    expect(officialEvent.className).toContain("text-accent-on");
  });

  it("never renders a Tickets button when there is no verified ticket destination", async () => {
    await renderPage(makeEvent({ officialEventUrl: "https://venue.example.com/event", ticketUrl: null }));
    expect(screen.queryByText(/^Tickets/i)).toBeNull();
  });

  it("renders no primary CTA block at all when the event has no external links", async () => {
    await renderPage(
      makeEvent({ officialEventUrl: null, ticketUrl: null, facebookUrl: null, residentAdvisorUrl: null, otherSourceUrls: [] }),
    );
    expect(screen.queryByText(/^Official event/i)).toBeNull();
    expect(screen.queryByText(/^Tickets/i)).toBeNull();
  });

  it("a bare Source-only link (no Tickets, no Official event) is never promoted to the primary/filled-accent treatment — it stays secondary/outline (fallback narrowed, 2026-09-26 review)", async () => {
    await renderPage(
      makeEvent({
        officialEventUrl: null,
        ticketUrl: null,
        facebookUrl: null,
        residentAdvisorUrl: null,
        otherSourceUrls: ["https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=99"],
      }),
    );
    const source = screen.getByRole("link", { name: /^Source/i });
    expect(source.className).not.toContain("bg-accent");
    expect(source.className).not.toContain("text-accent-on");
    expect(source.className).toContain("border-border-strong");
  });

  it("both primary and secondary CTAs preserve the existing external-link ↗ semantics", async () => {
    await renderPage(
      makeEvent({ officialEventUrl: "https://venue.example.com/event", ticketUrl: "https://billetto.dk/e/x" }),
    );
    const tickets = screen.getByRole("link", { name: /^Tickets/i });
    const officialEvent = screen.getByRole("link", { name: /^Official event/i });
    expect(tickets.textContent).toContain("↗");
    expect(officialEvent.textContent).toContain("↗");
  });

  it("gives the primary CTA a ~44px tap target with 12px text on every screen (event-page action layout, 2026-10-17)", async () => {
    await renderPage(makeEvent({ ticketUrl: "https://billetto.dk/e/x" }));
    const tickets = screen.getByRole("link", { name: /^Tickets/i });
    expect(tickets.className).toContain("min-h-11");
    expect(tickets.className).toContain("text-xs");
  });
});

describe("Event detail page — responsive action layout (event-page action layout, 2026-10-17)", () => {
  afterEach(cleanup);

  const BOTH = { officialEventUrl: "https://venue.example.com/event", ticketUrl: "https://billetto.dk/e/x" };

  it("primary and secondary CTAs: ~44px tall, 12px text, 16px padding, a minimum width, never wrapping their label", async () => {
    await renderPage(makeEvent(BOTH));
    for (const name of [/^Tickets/i, /^Official event/i]) {
      const cta = screen.getByRole("link", { name });
      for (const cls of ["min-h-11", "text-xs", "px-4", "min-w-[8.5rem]", "whitespace-nowrap"]) {
        expect(cta.className).toContain(cls);
      }
    }
  });

  it("Tickets + Official event split the row on mobile and return to natural width from sm:", async () => {
    await renderPage(makeEvent(BOTH));
    for (const name of [/^Tickets/i, /^Official event/i]) {
      const cta = screen.getByRole("link", { name });
      expect(cta.className).toContain("flex-1");
      expect(cta.className).toContain("sm:flex-none");
    }
  });

  it("a lone primary CTA keeps its natural width on mobile too (no flex-1)", async () => {
    await renderPage(makeEvent({ officialEventUrl: "https://venue.example.com/event" }));
    const official = screen.getByRole("link", { name: /^Official event/i });
    expect(official.className).not.toContain("flex-1");
    expect(official.className).toContain("min-w-[8.5rem]");
  });

  it("a Source-only fallback keeps the outline treatment and natural width", async () => {
    await renderPage(makeEvent({ otherSourceUrls: ["https://kultunaut.dk/x"] }));
    const source = screen.getByRole("link", { name: /^Source/i });
    expect(source.className).toContain("border");
    expect(source.className).not.toContain("bg-accent");
    expect(source.className).not.toContain("flex-1");
  });

  it("left-aligned rows with an 8px gap on mobile, 12px from sm:", async () => {
    await renderPage(makeEvent(BOTH));
    const ctaRow = screen.getByRole("link", { name: /^Tickets/i }).parentElement!;
    const secondaryRow = screen.getByRole("button", { name: "Add to calendar" }).parentElement!.parentElement!;
    for (const row of [ctaRow, secondaryRow]) {
      expect(row.className).toContain("gap-2");
      expect(row.className).toContain("sm:gap-3");
      expect(row.className).not.toContain("justify-between");
      expect(row.className).not.toContain("justify-end");
    }
  });

  it("renders no CTA row at all when there are no links, but the secondary row (calendar + Share) always renders", async () => {
    await renderPage(makeEvent({ officialEventUrl: null, ticketUrl: null, otherSourceUrls: [] }));
    expect(screen.queryByRole("link", { name: /↗/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Add to calendar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Share /i })).toBeTruthy();
  });

  it("Add to calendar is a labelled ~44px button whose text stays visible on mobile, with a left-anchored desktop menu", async () => {
    await renderPage(makeEvent());
    const calendarButton = screen.getByRole("button", { name: "Add to calendar" });
    expect(calendarButton.className).toContain("min-h-11");
    const label = Array.from(calendarButton.querySelectorAll("span")).find((s) => s.textContent === "Add to calendar");
    expect(label).toBeTruthy();
    expect(label!.className).not.toContain("hidden");
    fireEvent.click(calendarButton);
    expect(screen.getByRole("menu", { name: "Add to calendar" }).className).toContain("sm:start-0");
  });

  it("renders Share as an icon-only 44x44px button on mobile, with the text label restored at sm: (icon and behaviour unchanged)", async () => {
    await renderPage(makeEvent());
    const shareButton = screen.getByRole("button", { name: /^Share /i });
    expect(shareButton.className).toContain("h-11");
    expect(shareButton.className).toContain("w-11");
    expect(shareButton.className).toContain("sm:h-auto");
    expect(shareButton.className).toContain("sm:w-auto");
    expect(shareButton.className).toContain("sm:min-h-[2.75rem]");
    expect(shareButton.querySelector("svg")).not.toBeNull();
    const textSpan = Array.from(shareButton.querySelectorAll("span")).find((s) => s.textContent === "Share");
    expect(textSpan?.className).toContain("hidden");
    expect(textSpan?.className).toContain("sm:inline");
  });

  it("keeps Share's accessible label unchanged — icon-only is presentation only", async () => {
    await renderPage(makeEvent({ title: "Warehouse Night" }));
    expect(screen.getByRole("button", { name: "Share Warehouse Night" })).toBeTruthy();
  });

  it("keeps the logical action order Tickets -> Official event -> Add to calendar -> Share in the DOM (keyboard order)", async () => {
    await renderPage(makeEvent(BOTH));
    const order = [
      screen.getByRole("link", { name: /^Tickets/i }),
      screen.getByRole("link", { name: /^Official event/i }),
      screen.getByRole("button", { name: "Add to calendar" }),
      screen.getByRole("button", { name: /^Share /i }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

describe("Event detail page — Artist Preview positioned below Add to calendar, ahead of About (content-order revision, 2026-10-09)", () => {
  afterEach(cleanup);

  it("renders the Artist Preview embed above the About heading (previously rendered below it)", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({
      artistName: "Eric Prydz",
      videoId: "abc123XYZ",
      videoTitle: "Eric Prydz DJ Set",
      channelTitle: "Eric Prydz",
    });
    await renderPage(makeEvent({ artists: ["Eric Prydz"], description: "Some description." }));

    const aboutHeading = screen.getByText("About");
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.compareDocumentPosition(aboutHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the Artist Preview embed after the secondary actions (Add to calendar, Share) and the Get a taste heading", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({
      artistName: "Eric Prydz",
      videoId: "abc123XYZ",
      videoTitle: "Eric Prydz DJ Set",
      channelTitle: "Eric Prydz",
    });
    await renderPage(makeEvent({ artists: ["Eric Prydz"] }));

    const iframe = document.querySelector("iframe")!;
    const calendarButton = screen.getByRole("button", { name: "Add to calendar" });
    const shareButton = screen.getByRole("button", { name: /^Share /i });
    const heading = screen.getByRole("heading", { level: 2, name: "Get a taste" });
    expect(calendarButton.compareDocumentPosition(shareButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shareButton.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(iframe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Artist Preview never appears before the Tickets/Official event CTA", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({
      artistName: "Eric Prydz",
      videoId: "abc123XYZ",
      videoTitle: "Eric Prydz DJ Set",
      channelTitle: "Eric Prydz",
    });
    await renderPage(makeEvent({ artists: ["Eric Prydz"], ticketUrl: "https://billetto.dk/e/x" }));

    const tickets = screen.getByRole("link", { name: /^Tickets/i });
    const iframe = document.querySelector("iframe")!;
    expect(tickets.compareDocumentPosition(iframe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Event detail page — Artist Preview #video anchor (homepage VIDEO deep-link work, 2026-09-26)", () => {
  afterEach(cleanup);

  it("the Artist Preview section has id=\"video\" on its own container, not on the iframe", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({
      artistName: "Eric Prydz",
      videoId: "abc123XYZ",
      videoTitle: "Eric Prydz DJ Set",
      channelTitle: "Eric Prydz",
    });
    await renderPage(makeEvent({ artists: ["Eric Prydz"] }));

    const anchor = document.getElementById("video");
    expect(anchor).not.toBeNull();
    expect(anchor!.tagName).not.toBe("IFRAME");
    expect(anchor!.querySelector("iframe")).not.toBeNull();
  });

  it("no #video anchor exists when there is no Artist Preview", async () => {
    await renderPage(makeEvent({ artists: ["Some Artist"] }));
    expect(document.getElementById("video")).toBeNull();
  });

  it("keeps youtube-nocookie.com and no autoplay parameter on the embed src", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({
      artistName: "Eric Prydz",
      videoId: "abc123XYZ",
      videoTitle: "Eric Prydz DJ Set",
      channelTitle: "Eric Prydz",
    });
    await renderPage(makeEvent({ artists: ["Eric Prydz"] }));

    const iframe = document.querySelector("iframe")!;
    expect(iframe.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/abc123XYZ");
    expect(iframe.getAttribute("src")).not.toContain("autoplay");
  });
});

describe("Event detail page — SoundCloud artist links (venue-provided, 2026-10-13)", () => {
  afterEach(cleanup);

  const PILOT_EVENT_ID = "e-bf9d6551";
  const PILOT_ARTISTS = ["TIM ANDRESEN", "REXIE LEX"];
  const PILOT_LINKS = [
    { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" },
    { name: "REXIE LEX", url: "https://soundcloud.com/rexie_lex" },
  ];

  it("renders a #soundcloud section listing only the verified pilot artists, with real external links", async () => {
    await renderPage(makeEvent({ id: PILOT_EVENT_ID, artists: [...PILOT_ARTISTS, "SOME OTHER ARTIST"] }), [], PILOT_LINKS);

    const anchor = document.getElementById("soundcloud");
    expect(anchor).not.toBeNull();
    const links = anchor!.querySelectorAll("a");
    expect(links).toHaveLength(2);
    const hrefs = Array.from(links).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://soundcloud.com/tim-andresen");
    expect(hrefs).toContain("https://soundcloud.com/rexie_lex");
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    // Never embeds a player/iframe for SoundCloud.
    expect(anchor!.querySelector("iframe")).toBeNull();
  });

  it("shows only the artist name and the ↗ glyph per link — no repeated 'on SoundCloud' text (UI-refinement round)", async () => {
    await renderPage(makeEvent({ id: PILOT_EVENT_ID, artists: PILOT_ARTISTS }), [], PILOT_LINKS);

    const anchor = document.getElementById("soundcloud")!;
    const links = Array.from(anchor.querySelectorAll("a"));
    const visibleTexts = links.map((a) =>
      Array.from(a.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join(""),
    );
    expect(visibleTexts.sort()).toEqual(["REXIE LEX ↗", "TIM ANDRESEN ↗"]);
    expect(anchor.textContent).not.toContain("on SoundCloud");
  });

  it("heads the links with an h3 'Listen on' + the official SoundCloud wordmark (accessible name 'Listen on SoundCloud'), not hand-drawn markup", async () => {
    await renderPage(makeEvent({ id: PILOT_EVENT_ID, artists: PILOT_ARTISTS }), [], PILOT_LINKS);

    const anchor = document.getElementById("soundcloud")!;
    const heading = screen.getByRole("heading", { level: 3, name: "Listen on SoundCloud" });
    expect(anchor.contains(heading)).toBe(true);
    // The brand name is never printed as text next to the wordmark.
    expect(screen.queryByText("SoundCloud")).toBeNull();
    const logo = heading.querySelector("img")!;
    expect(logo).not.toBeNull();
    expect(logo.getAttribute("alt")).toBe("SoundCloud");
    expect(logo.getAttribute("src")).toBe("/brand/soundcloud-logo-white.png");
    // No inline <svg> hand-authored in the component — the mark is a real
    // image asset, never redrawn/recolored in code.
    expect(anchor.querySelector("svg")).toBeNull();
  });

  it("looks links up for the event's own id and current lineup", async () => {
    await renderPage(makeEvent({ id: PILOT_EVENT_ID, artists: PILOT_ARTISTS }), [], PILOT_LINKS);
    expect(getSoundcloudLinksForLineup).toHaveBeenCalledWith(PILOT_EVENT_ID, PILOT_ARTISTS);
  });

  it("no #soundcloud section when the event has no links", async () => {
    await renderPage(makeEvent({ id: "e-some-other-event", artists: PILOT_ARTISTS }));
    expect(document.getElementById("soundcloud")).toBeNull();
  });

  it("can render alongside the Artist Preview video section", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({
      artistName: "Tim Andresen",
      videoId: "abc123XYZ",
      videoTitle: "Tim Andresen DJ Set",
      channelTitle: "Tim Andresen",
    });
    await renderPage(makeEvent({ id: PILOT_EVENT_ID, artists: PILOT_ARTISTS }), [], PILOT_LINKS);
    expect(document.getElementById("video")).not.toBeNull();
    expect(document.getElementById("soundcloud")).not.toBeNull();
  });

  it("renders in the order VIDEO -> SOUNDCLOUD -> About (content-order revision, 2026-10-09)", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({
      artistName: "Tim Andresen",
      videoId: "abc123XYZ",
      videoTitle: "Tim Andresen DJ Set",
      channelTitle: "Tim Andresen",
    });
    await renderPage(makeEvent({ id: PILOT_EVENT_ID, artists: PILOT_ARTISTS, description: "Some description." }), [], PILOT_LINKS);

    const videoSection = document.getElementById("video")!;
    const soundcloudSection = document.getElementById("soundcloud")!;
    const aboutHeading = screen.getByText("About");
    expect(videoSection.compareDocumentPosition(soundcloudSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(soundcloudSection.compareDocumentPosition(aboutHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the links in the order the lookup returns them (lineup order)", async () => {
    await renderPage(makeEvent({ artists: ["GUY J", "TIM ANDRESEN", "EZEQUIEL PERINI"] }), [], [
      { name: "GUY J", url: "https://soundcloud.com/guy-j" },
      { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" },
    ]);
    const anchor = document.getElementById("soundcloud")!;
    expect(Array.from(anchor.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
      "https://soundcloud.com/guy-j",
      "https://soundcloud.com/tim-andresen",
    ]);
    expect(anchor.querySelector("iframe")).toBeNull();
  });
});

describe("Event detail page — Get a taste (event-page action layout, 2026-10-17)", () => {
  afterEach(cleanup);

  const VIDEO = { artistName: "TIM ANDRESEN", videoId: "abc123XYZ", videoTitle: "Live at Culture Box", channelTitle: "Tim Andresen" };
  const LINKS = [
    { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" },
    { name: "REXIE LEX", url: "https://soundcloud.com/rexie_lex" },
  ];
  const ARTISTS = ["TIM ANDRESEN", "REXIE LEX"];

  it("asks for the video by this event (its id and lineup), so a per-event override applies to this event only", async () => {
    const event = makeEvent({ artists: ARTISTS });
    await renderPage(event);
    expect(getEventYoutubePreview).toHaveBeenCalledWith(expect.objectContaining({ id: event.id, artists: ARTISTS }));
  });

  it("is absent when there is neither a video nor SoundCloud links", async () => {
    await renderPage(makeEvent({ artists: ARTISTS }));
    expect(screen.queryByRole("heading", { name: "Get a taste" })).toBeNull();
    expect(document.querySelector("section")).toBeNull();
  });

  it("video only: one h2 'Get a taste' and the embed — no 'video preview' heading and no artist caption under the player", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce(VIDEO);
    await renderPage(makeEvent({ artists: ARTISTS }));
    const heading = screen.getByRole("heading", { level: 2, name: "Get a taste" });
    const section = heading.closest("section")!;
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(section.querySelector("iframe")).not.toBeNull();
    // No separate artist label under the player (removed 2026-10-18): the
    // player is the section's last element, with nothing (and no empty
    // spacer) after it.
    expect(section.querySelector("figure, figcaption")).toBeNull();
    expect(section.textContent).not.toContain("TIM ANDRESEN");
    expect(section.lastElementChild!.querySelector("iframe")).not.toBeNull();
    expect(screen.queryByText(/video preview/i)).toBeNull();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    // The iframe keeps its own accessible title (the video's title).
    expect(section.querySelector("iframe")!.getAttribute("title")).toBe("YouTube video: Live at Culture Box");
  });

  it("an admin-chosen video with no title and no artist name is named after the event, never after a lineup name", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({ ...VIDEO, artistName: null, videoTitle: "  " });
    await renderPage(makeEvent({ title: "Warehouse Night", artists: ARTISTS }));
    const title = document.querySelector("iframe")!.getAttribute("title");
    expect(title).toBe("YouTube video for Warehouse Night");
    expect(title).not.toContain("TIM ANDRESEN");
  });

  it("with no video title, an automated match is named after its artist", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce({ ...VIDEO, videoTitle: null });
    await renderPage(makeEvent({ artists: ARTISTS }));
    expect(document.querySelector("iframe")!.getAttribute("title")).toBe("YouTube video: TIM ANDRESEN");
  });

  it("SoundCloud only: 'Get a taste' then 'Listen on SoundCloud', no #video anchor, links right under the heading", async () => {
    await renderPage(makeEvent({ artists: ARTISTS }), [], LINKS);
    const h2 = screen.getByRole("heading", { level: 2, name: "Get a taste" });
    const h3 = screen.getByRole("heading", { level: 3, name: "Listen on SoundCloud" });
    expect(h2.compareDocumentPosition(h3) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById("video")).toBeNull();
    expect(document.getElementById("soundcloud")!.className).toContain("mt-3");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("both: video first as the primary element, SoundCloud after extra vertical air, one shared section", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce(VIDEO);
    await renderPage(makeEvent({ artists: ARTISTS }), [], LINKS);
    const section = screen.getByRole("heading", { level: 2, name: "Get a taste" }).closest("section")!;
    const soundcloud = document.getElementById("soundcloud")!;
    expect(section.contains(soundcloud)).toBe(true);
    expect(section.querySelector("iframe")!.compareDocumentPosition(soundcloud) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(soundcloud.className).toContain("mt-8");
    expect(soundcloud.className).toContain("sm:mt-10");
    // Artist names stay on the SoundCloud links — only the video caption went.
    expect(soundcloud.querySelector('a[href="https://soundcloud.com/tim-andresen"]')!.textContent).toContain("TIM ANDRESEN");
    expect(section.querySelector("figcaption")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2, name: "Get a taste" })).toHaveLength(1);
  });

  it("#video (homepage VIDEO badge) targets the section, so the jump lands with its heading in view; #soundcloud stays on the SoundCloud block", async () => {
    vi.mocked(getEventYoutubePreview).mockResolvedValueOnce(VIDEO);
    await renderPage(makeEvent({ artists: ARTISTS }), [], LINKS);
    const video = document.getElementById("video")!;
    expect(video.tagName).toBe("SECTION");
    expect(video.className).toContain("scroll-mt-4");
    expect(video.querySelector("h2")!.textContent).toBe("Get a taste");
    expect(document.getElementById("soundcloud")!.className).toContain("scroll-mt-4");
  });

  it("SoundCloud artists are one wrapping row with ~44px tap targets on mobile and 32px from sm:", async () => {
    await renderPage(makeEvent({ artists: ARTISTS }), [], LINKS);
    const list = document.getElementById("soundcloud")!.querySelector("ul")!;
    expect(list.className).toContain("flex-wrap");
    expect(list.className).not.toContain("flex-col");
    for (const link of Array.from(list.querySelectorAll("a"))) {
      expect(link.className).toContain("min-h-11");
      expect(link.className).toContain("sm:min-h-8");
    }
  });
});

describe("Event detail page — SEO <title> and meta description (2026-10-06)", () => {
  it("emits an absolute title (no second brand from the layout template) and a factual description; canonical/OG unchanged", async () => {
    const { generateMetadata } = await import("./page");
    vi.mocked(getEventBySlugWithVenue).mockResolvedValue(
      makeEvent({
        title: "Eric Prydz",
        slug: "eric-prydz-tap1",
        artists: ["Eric Prydz"],
        startDatetime: "2026-10-23T18:00:00.000Z",
        venue: { ...VENUE, name: "TAP1" },
      }),
    );
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "eric-prydz-tap1" }) } as never);
    expect(metadata.title).toEqual({ absolute: "Eric Prydz - TAP1, Copenhagen - 23 Oct 2026 | Electronic CPH" });
    expect(metadata.description).toBe("Eric Prydz at TAP1, Copenhagen on Friday 23 October 2026. Drum & Bass.");
    expect(metadata.alternates).toEqual({ canonical: "/events/eric-prydz-tap1" });
    expect(metadata.openGraph).toMatchObject({
      title: "Eric Prydz",
      description: "Eric Prydz: Eric Prydz — Drum & Bass at TAP1, Copenhagen, on Friday 23 October 2026.",
    });
  });
});
