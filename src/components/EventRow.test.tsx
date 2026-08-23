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

describe("EventRow — clickability affordance (Round 13: brighten-only title, non-purple)", () => {
  afterEach(cleanup);

  it("gives the event title link a slight brighten on hover/focus, no purple color change, no underline, and a pointer cursor", () => {
    render(<EventRow event={makeEvent()} />);
    const titleLink = screen.getByRole("link", { name: /Test Event/ });
    const classes = titleLink.className.split(/\s+/);
    expect(titleLink.getAttribute("href")).toBe("/events/test-event");
    expect(classes).toContain("hover:brightness-110");
    expect(classes).toContain("focus-visible:brightness-110");
    expect(classes).toContain("cursor-pointer");
    expect(classes).not.toContain("hover:text-accent");
    expect(classes).not.toContain("focus-visible:text-accent");
    expect(classes).not.toContain("hover:text-accent-strong");
    expect(classes).not.toContain("focus-visible:text-accent-strong");
    expect(titleLink.className).not.toContain("underline");
  });

  it("gives the venue name link a brighten + subtle underline on hover/focus, no purple color change, linking to the venue page", () => {
    render(<EventRow event={makeEvent()} />);
    const venueLink = screen.getByRole("link", { name: "Test Venue" });
    const classes = venueLink.className.split(/\s+/);
    expect(venueLink.getAttribute("href")).toBe("/venues/test-venue");
    expect(classes).toContain("hover:text-text-primary");
    expect(classes).toContain("focus-visible:text-text-primary");
    expect(classes).toContain("hover:decoration-current");
    expect(classes).toContain("focus-visible:decoration-current");
    expect(classes).not.toContain("hover:text-accent");
    expect(classes).not.toContain("focus-visible:text-accent");
    expect(classes).not.toContain("hover:text-accent-strong");
    expect(classes).not.toContain("focus-visible:text-accent-strong");
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

describe("EventRow — three-level text hierarchy (Round 18: new secondary-strong grey)", () => {
  afterEach(cleanup);

  it("puts the supplementary lineup on the new secondary-strong grey, not the old muted secondary", () => {
    render(<EventRow event={makeEvent({ title: "Byhaven: Anything Everything", artists: ["Clara Andreis", "Jesper Olsen"] })} />);
    const lineup = screen.getByText(/Clara Andreis \/ Jesper Olsen/);
    expect(lineup.className).toContain("text-text-secondary-strong");
    expect(lineup.className.split(/\s+/)).not.toContain("text-text-secondary");
  });

  it("puts the venue link on the new secondary-strong grey, brighter than metadata", () => {
    render(<EventRow event={makeEvent()} />);
    const venueLink = screen.getByRole("link", { name: "Test Venue" });
    const classes = venueLink.className.split(/\s+/);
    expect(classes).toContain("text-text-secondary-strong");
    expect(classes).not.toContain("text-text-secondary");
  });

  it("keeps genre and time on the unchanged, more-muted metadata grey (text-text-tertiary)", () => {
    render(<EventRow event={makeEvent()} />);
    const genre = screen.getByText("Drum & Bass");
    expect(genre.className).toContain("text-text-tertiary");
    expect(genre.className).not.toContain("text-text-secondary-strong");
  });

  it("puts OFFICIAL EVENT / TICKETS links on the new secondary-strong grey", () => {
    render(
      <EventRow
        event={makeEvent({
          officialEventUrl: "https://venue.example.com/event",
          ticketUrl: "https://billetto.dk/e/x",
        })}
      />,
    );
    const officialEvent = screen.getByText(/Official event/i);
    const tickets = screen.getByText(/Tickets/i);
    expect(officialEvent.className).toContain("text-text-secondary-strong");
    expect(tickets.className).toContain("text-text-secondary-strong");
  });

  it("keeps FREE on primary off-white, untouched by the new secondary-strong level", () => {
    render(<EventRow event={makeEvent({ priceFrom: 0, ticketUrl: null, residentAdvisorUrl: null })} />);
    const free = screen.getByText("Free");
    expect(free.className).toContain("text-text-primary");
    expect(free.className).not.toContain("text-text-secondary-strong");
  });
});

describe("EventRow — public/internal status separation (event-status audit, DATE/TIME CHANGED are internal-only)", () => {
  afterEach(cleanup);

  it("shows no status text for a normal event", () => {
    render(<EventRow event={makeEvent()} />);
    expect(screen.queryByText(/Cancelled/i)).toBeNull();
    expect(screen.queryByText(/Sold out/i)).toBeNull();
    expect(screen.queryByText(/Date changed/i)).toBeNull();
    expect(screen.queryByText(/Time changed/i)).toBeNull();
  });

  it("dateChanged alone renders no public status", () => {
    render(<EventRow event={makeEvent({ dateChanged: true })} />);
    expect(screen.queryByText(/Date changed/i)).toBeNull();
    expect(screen.queryByText(/Cancelled/i)).toBeNull();
    expect(screen.queryByText(/Sold out/i)).toBeNull();
  });

  it("timeChanged alone renders no public status", () => {
    render(<EventRow event={makeEvent({ timeChanged: true })} />);
    expect(screen.queryByText(/Time changed/i)).toBeNull();
    expect(screen.queryByText(/Cancelled/i)).toBeNull();
    expect(screen.queryByText(/Sold out/i)).toBeNull();
  });

  it("dateChanged + timeChanged together still render no public status", () => {
    render(<EventRow event={makeEvent({ dateChanged: true, timeChanged: true })} />);
    expect(screen.queryByText(/Date changed/i)).toBeNull();
    expect(screen.queryByText(/Time changed/i)).toBeNull();
  });

  it("cancelled still renders CANCELLED", () => {
    render(<EventRow event={makeEvent({ cancelled: true })} />);
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  it("soldOut still renders SOLD OUT", () => {
    render(<EventRow event={makeEvent({ soldOut: true })} />);
    expect(screen.getByText("Sold out")).toBeTruthy();
  });

  it("cancelled + internal dateChanged shows only CANCELLED, not a second status", () => {
    render(<EventRow event={makeEvent({ cancelled: true, dateChanged: true, timeChanged: true })} />);
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByText(/Date changed/i)).toBeNull();
    expect(screen.queryByText(/Time changed/i)).toBeNull();
  });

  it("soldOut + internal dateChanged shows only SOLD OUT, not a second status", () => {
    render(<EventRow event={makeEvent({ soldOut: true, dateChanged: true, timeChanged: true })} />);
    expect(screen.getByText("Sold out")).toBeTruthy();
    expect(screen.queryByText(/Date changed/i)).toBeNull();
    expect(screen.queryByText(/Time changed/i)).toBeNull();
  });

  it("FREE is unaffected by internal dateChanged/timeChanged noise", () => {
    render(
      <EventRow
        event={makeEvent({ priceFrom: 0, ticketUrl: null, residentAdvisorUrl: null, dateChanged: true, timeChanged: true })}
      />,
    );
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.queryByText(/Date changed/i)).toBeNull();
  });

  it("CANCELLED uses the existing status-bad red tone, SOLD OUT uses a neutral secondary tone (not amber, not purple)", () => {
    render(<EventRow event={makeEvent({ cancelled: true, soldOut: true })} />);
    const cancelled = screen.getByText("Cancelled");
    const soldOut = screen.getByText("Sold out");
    expect(cancelled.className).toContain("text-status-bad");
    expect(soldOut.className).not.toContain("text-status-bad");
    expect(soldOut.className).not.toContain("text-status-warn");
    expect(soldOut.className).not.toContain("text-accent");
  });
});

describe("EventRow — sub-venue title cleanup (Pumpehuset Byhaven / Culture Box rooms)", () => {
  afterEach(cleanup);

  it("strips the Byhaven prefix from a Pumpehuset event's displayed title", () => {
    render(
      <EventRow
        event={makeEvent({
          title: "Byhaven: Love.Rave",
          venue: { ...VENUE, name: "Pumpehuset" },
          artists: [],
        })}
      />,
    );
    expect(screen.getByRole("link", { name: "Love.Rave" })).toBeTruthy();
    expect(screen.queryByText(/Byhaven:/)).toBeNull();
  });

  it("strips Culture Box room prefixes from a two-room event's displayed title", () => {
    render(
      <EventRow
        event={makeEvent({
          title: "Black Box: TECHNO SPECIAL · Red Box: HOUSE SPECIAL",
          venue: { ...VENUE, name: "Culture Box" },
          artists: [],
        })}
      />,
    );
    expect(screen.getByText(/TECHNO SPECIAL · HOUSE SPECIAL/)).toBeTruthy();
    expect(screen.queryByText(/Black Box:/)).toBeNull();
    expect(screen.queryByText(/Red Box:/)).toBeNull();
  });

  it("leaves a title with the same wording unchanged at a venue the rule doesn't apply to", () => {
    render(
      <EventRow
        event={makeEvent({
          title: "Byhaven: Love.Rave",
          venue: { ...VENUE, name: "Test Venue" },
          artists: [],
        })}
      />,
    );
    expect(screen.getByText(/Byhaven: Love\.Rave/)).toBeTruthy();
  });
});
