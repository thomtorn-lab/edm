// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EventRow from "./EventRow";
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

describe("EventRow — genre display and ticket/free CTA", () => {
  afterEach(cleanup);

  it("renders 'Drum & Bass' in full, never the abbreviation 'D&B'", () => {
    render(<EventRow event={makeEvent()} />);
    expect(screen.getByText("Drum & Bass")).toBeTruthy();
    expect(screen.queryByText(/D&B/)).toBeNull();
  });

  it("shows a FREE badge when there is no ticket link but free-admission evidence exists", () => {
    render(<EventRow event={makeEvent({ priceFrom: 0, ticketUrl: null, residentAdvisorUrl: null })} />);
    expect(screen.getByText("Free")).toBeTruthy();
  });

  it("never shows FREE merely because a ticket link is missing — priceFrom null is not evidence", () => {
    render(<EventRow event={makeEvent({ priceFrom: null, ticketUrl: null, residentAdvisorUrl: null })} />);
    expect(screen.queryByText("Free")).toBeNull();
  });

  it("shows TICKETS (not FREE) when a ticket link exists, even if priceFrom happens to be 0", () => {
    render(<EventRow event={makeEvent({ priceFrom: 0, ticketUrl: "https://billetto.dk/e/x" })} />);
    expect(screen.getByText(/Tickets/)).toBeTruthy();
    expect(screen.queryByText("Free")).toBeNull();
  });

  it("places FREE to the right of OFFICIAL EVENT — never before it (frontend polish, Round 7)", () => {
    render(
      <EventRow
        event={makeEvent({
          priceFrom: 0,
          ticketUrl: null,
          residentAdvisorUrl: null,
          officialEventUrl: "https://venue.example.com/event",
        })}
      />,
    );
    const officialEvent = screen.getByText(/Official event/i);
    const free = screen.getByText("Free");
    // DOCUMENT_POSITION_FOLLOWING (4) means `free` comes after `officialEvent`.
    expect(officialEvent.compareDocumentPosition(free) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders FREE in white with comparable weight to OFFICIAL EVENT, not a dim secondary note", () => {
    render(<EventRow event={makeEvent({ priceFrom: 0, ticketUrl: null, residentAdvisorUrl: null })} />);
    const free = screen.getByText("Free");
    expect(free.className).toContain("text-text-primary");
    expect(free.className).toContain("font-semibold");
    expect(free.className).not.toContain("text-accent-strong");
  });
});

describe("EventRow — clickability affordance (Round 8, refined Round 9: color-only, no underline)", () => {
  afterEach(cleanup);

  it("gives the event title link a hover and keyboard-focus accent-color shift, no underline", () => {
    render(<EventRow event={makeEvent()} />);
    const titleLink = screen.getByRole("link", { name: /Test Event/ });
    const classes = titleLink.className.split(/\s+/);
    expect(titleLink.getAttribute("href")).toBe("/events/test-event");
    expect(classes).toContain("hover:text-accent");
    expect(classes).toContain("focus-visible:text-accent");
    expect(classes).not.toContain("hover:text-accent-strong");
    expect(classes).not.toContain("focus-visible:text-accent-strong");
    expect(titleLink.className).not.toContain("underline");
  });

  it("gives the venue name link a hover and keyboard-focus accent-color shift, no underline, linking to the venue page", () => {
    render(<EventRow event={makeEvent()} />);
    const venueLink = screen.getByRole("link", { name: "Test Venue" });
    const classes = venueLink.className.split(/\s+/);
    expect(venueLink.getAttribute("href")).toBe("/venues/test-venue");
    expect(classes).toContain("hover:text-accent");
    expect(classes).toContain("focus-visible:text-accent");
    expect(classes).not.toContain("hover:text-accent-strong");
    expect(classes).not.toContain("focus-visible:text-accent-strong");
    expect(venueLink.className).not.toContain("underline");
  });
});

describe("EventRow — hover color actually reaches the visible text (Round 11)", () => {
  afterEach(cleanup);

  it("the title's own text is a direct child of the hover-colored link, not nested in a differently-colored span", () => {
    render(<EventRow event={makeEvent()} />);
    const titleLink = screen.getByRole("link", { name: /Test Event/ });
    // The visible title text must be a direct text node of the element that
    // carries hover:text-accent, so the color change actually reaches it —
    // a child <span> with its own text-* class would silently win instead.
    const directTextNodes = Array.from(titleLink.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE);
    expect(directTextNodes.some((n) => n.textContent === "Test Event")).toBe(true);
  });

  it("the venue name text is a direct child of the hover-colored venue link", () => {
    render(<EventRow event={makeEvent()} />);
    const venueLink = screen.getByRole("link", { name: "Test Venue" });
    expect(venueLink.children.length).toBe(0);
    expect(venueLink.textContent).toBe("Test Venue");
  });
});

describe("EventRow — no whole-row hover affordance (Round 10)", () => {
  afterEach(cleanup);

  it("does not change the row background on hover — the row itself is not clickable", () => {
    const { container } = render(<EventRow event={makeEvent()} />);
    const li = container.querySelector("li");
    expect(li?.className).not.toContain("group");
    const row = li?.firstElementChild as HTMLElement;
    expect(row.className).not.toContain("group-hover");
    expect(row.className).not.toContain("bg-surface-1");
  });
});

describe("EventRow — redundant artist preview suppression (Round 12)", () => {
  afterEach(cleanup);

  it("suppresses the grey artist preview when a per-room lineup title already names every artist", () => {
    render(
      <EventRow
        event={makeEvent({
          title: "Black Box: TIMO MAAS, RYAN DANK, BALTZA · Red Box: KARINA LIN, ASLI",
          artists: ["TIMO MAAS", "RYAN DANK", "BALTZA", "KARINA LIN", "ASLI"],
        })}
      />,
    );
    expect(screen.queryByText(/TIMO MAAS \/ RYAN DANK/)).toBeNull();
    expect(screen.getByText(/Black Box: TIMO MAAS/)).toBeTruthy();
  });

  it("keeps the grey artist preview when the title is a distinct showcase name", () => {
    render(
      <EventRow
        event={makeEvent({
          title: "HYGGELIT SHOWCASE",
          artists: ["SOPHIE VAN HAYDEN", "NAIVA", "ONSBERG"],
        })}
      />,
    );
    expect(screen.getByText(/SOPHIE VAN HAYDEN \/ NAIVA \/ ONSBERG/)).toBeTruthy();
  });

  it("renders no lineup text at all when the event has no artists", () => {
    render(<EventRow event={makeEvent({ title: "HYGGELIT SHOWCASE", artists: [] })} />);
    const titleLink = screen.getByRole("link", { name: "HYGGELIT SHOWCASE" });
    expect(titleLink.textContent).toBe("HYGGELIT SHOWCASE");
  });
});

describe("EventRow — desktop title gets up to two lines, CTAs top-align with it (Round 12)", () => {
  afterEach(cleanup);

  it("allows the title link up to two lines on desktop instead of single-line truncation", () => {
    render(<EventRow event={makeEvent()} />);
    const titleLink = screen.getByRole("link", { name: /Test Event/ });
    const classes = titleLink.className.split(/\s+/);
    expect(classes).toContain("sm:line-clamp-2");
    expect(classes).not.toContain("sm:truncate");
  });

  it("top-aligns the row's columns (date, title/meta, CTAs) on desktop instead of vertically centering them", () => {
    const { container } = render(<EventRow event={makeEvent()} />);
    const row = container.querySelector("li > div") as HTMLElement;
    const classes = row.className.split(/\s+/);
    expect(classes).toContain("sm:items-start");
    expect(classes).not.toContain("sm:items-center");
  });
});
