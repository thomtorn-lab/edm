// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
    dateChanged: false,
    timeChanged: false,
    published: true,
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
const { default: EventDetailPage } = await import("./page");

async function renderPage(event: EventWithVenue) {
  vi.mocked(getEventBySlugWithVenue).mockResolvedValue(event);
  const element = await EventDetailPage({ params: Promise.resolve({ slug: event.slug }) } as never);
  render(element);
}

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

describe("Event detail page — three-level text hierarchy (Round 18: new secondary-strong grey)", () => {
  afterEach(cleanup);

  it("puts OFFICIAL EVENT / TICKETS links on the same new secondary-strong grey used on the homepage", async () => {
    await renderPage(
      makeEvent({
        officialEventUrl: "https://venue.example.com/event",
        ticketUrl: "https://billetto.dk/e/x",
      }),
    );
    const officialEvent = screen.getByText(/Official event/i);
    const tickets = screen.getByText(/Tickets/i);
    expect(officialEvent.className).toContain("text-text-secondary-strong");
    expect(tickets.className).toContain("text-text-secondary-strong");
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

describe("Event detail page — public/internal status separation (event-status audit, DATE/TIME CHANGED are internal-only)", () => {
  afterEach(cleanup);

  it("shows no status text for a normal event", async () => {
    await renderPage(makeEvent());
    expect(screen.queryByText(/Cancelled/i)).toBeNull();
    expect(screen.queryByText(/Sold out/i)).toBeNull();
    expect(screen.queryByText(/Date changed/i)).toBeNull();
    expect(screen.queryByText(/Time changed/i)).toBeNull();
  });

  it("dateChanged + timeChanged together render no public status", async () => {
    await renderPage(makeEvent({ dateChanged: true, timeChanged: true }));
    expect(screen.queryByText(/Date changed/i)).toBeNull();
    expect(screen.queryByText(/Time changed/i)).toBeNull();
  });

  it("cancelled still renders CANCELLED", async () => {
    await renderPage(makeEvent({ cancelled: true }));
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  it("soldOut still renders SOLD OUT", async () => {
    await renderPage(makeEvent({ soldOut: true }));
    expect(screen.getByText("Sold out")).toBeTruthy();
  });

  it("cancelled + internal dateChanged shows only CANCELLED", async () => {
    await renderPage(makeEvent({ cancelled: true, dateChanged: true, timeChanged: true }));
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByText(/Date changed/i)).toBeNull();
    expect(screen.queryByText(/Time changed/i)).toBeNull();
  });

  it("soldOut + internal dateChanged shows only SOLD OUT", async () => {
    await renderPage(makeEvent({ soldOut: true, dateChanged: true, timeChanged: true }));
    expect(screen.getByText("Sold out")).toBeTruthy();
    expect(screen.queryByText(/Date changed/i)).toBeNull();
    expect(screen.queryByText(/Time changed/i)).toBeNull();
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

  it("renders the GENRE label with an OTHER chip for a genuinely-classified Other event, distinct from unknown/missing genre", async () => {
    await renderPage(makeEvent({ primaryGenre: "electronic-other", subgenres: ["electronic-other"] }));
    expect(screen.getByText("Genre")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });

  it("renders a real, non-Other genre normally (regression: the conditional wrap must not hide genuine genre chips)", async () => {
    await renderPage(makeEvent({ subgenres: ["drum-and-bass"] }));
    expect(screen.getByText("Genre")).toBeTruthy();
    expect(screen.getByText("Drum & Bass")).toBeTruthy();
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
