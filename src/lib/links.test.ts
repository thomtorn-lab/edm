import { describe, expect, it } from "vitest";
import { getExternalLinks, hasTicketDestination, isFreeAdmission, showFreeCta } from "./links";
import type { EventRecord } from "./types";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "e-001",
    title: "Fast Forward",
    slug: "fast-forward",
    description: null,
    artists: [],
    startDatetime: "2026-08-15T23:59:00+02:00",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: "v-hangaren",
    primaryGenre: "techno",
    subgenres: ["techno"],
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
    manualOverride: false,
    overriddenFields: [],
    confidence: "high",
    canonicalSourceId: null,
    createdAt: "2026-08-01T09:00:00+02:00",
    updatedAt: "2026-08-01T09:00:00+02:00",
    lastSourceCheck: null,
    lastChanged: null,
    ...overrides,
  };
}

describe("getExternalLinks — ticket CTA label", () => {
  it("labels a Resident Advisor link 'Tickets' when it's the only ticket destination", () => {
    const links = getExternalLinks(event({ residentAdvisorUrl: "https://ra.co/events/2345998" }));
    const ra = links.find((l) => l.href === "https://ra.co/events/2345998");
    expect(ra?.label).toBe("Tickets");
    expect(links.some((l) => l.label === "Resident Advisor")).toBe(false);
  });

  it("labels a Billetto ticket link 'Tickets'", () => {
    const links = getExternalLinks(event({ ticketUrl: "https://billetto.dk/e/fast-forward-hangaren" }));
    expect(links.find((l) => l.href === "https://billetto.dk/e/fast-forward-hangaren")?.label).toBe("Tickets");
  });

  it("labels any other external ticket provider link 'Tickets'", () => {
    const links = getExternalLinks(event({ ticketUrl: "https://vega.dk/tickets/tight-loop" }));
    expect(links.find((l) => l.href === "https://vega.dk/tickets/tight-loop")?.label).toBe("Tickets");
  });

  it("keeps the Resident Advisor label for the secondary RA reference when a distinct ticketUrl already covers the Tickets CTA", () => {
    const links = getExternalLinks(
      event({
        ticketUrl: "https://billetto.dk/e/fast-forward-hangaren",
        residentAdvisorUrl: "https://ra.co/events/2345678",
      }),
    );
    expect(links.find((l) => l.href === "https://billetto.dk/e/fast-forward-hangaren")?.label).toBe("Tickets");
    expect(links.find((l) => l.href === "https://ra.co/events/2345678")?.label).toBe("Resident Advisor");
  });

  it("collapses to a single Tickets link when ticketUrl and residentAdvisorUrl are the same RA URL", () => {
    const links = getExternalLinks(
      event({ ticketUrl: "https://ra.co/events/2461521", residentAdvisorUrl: "https://ra.co/events/2461521" }),
    );
    const matches = links.filter((l) => l.href === "https://ra.co/events/2461521");
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("Tickets");
  });
});

describe("getExternalLinks — event-link role classification (Zoumer reference case, 2026-09-05)", () => {
  // Real Production defect: Billetto's own event page is simultaneously its
  // "official" record and the ticket-purchase page from THAT source's own
  // point of view, so some write paths stored the identical URL in both
  // officialEventUrl and ticketUrl. The OLD dedup-by-insertion-order logic
  // always kept "Official event" (checked first) and silently dropped
  // "Tickets" — for Zoumer (canonicalSourceId "src-billetto", sourceType
  // "ticketing") that meant a pure ticketing destination was mislabeled as
  // a genuine first-party record. The role must come from the event's own
  // canonical source's sourceType (src/lib/data/sources.ts — already-
  // modeled, structural evidence), never from which field happened to hold
  // the URL, and never from hardcoding this one event/domain.

  it("1. ticket URL only -> TICKETS only", () => {
    const links = getExternalLinks(event({ ticketUrl: "https://ra.co/events/1" }));
    expect(links).toEqual([{ label: "Tickets", href: "https://ra.co/events/1", primary: false }]);
  });

  it("2. official event URL only (genuine first-party source) -> OFFICIAL EVENT only", () => {
    const links = getExternalLinks(
      event({ officialEventUrl: "https://www.hangaren.dk/events/kander", canonicalSourceId: "src-hangaren" }),
    );
    expect(links).toEqual([{ label: "Official event", href: "https://www.hangaren.dk/events/kander", primary: true }]);
  });

  it("3. distinct official + ticket URLs -> both", () => {
    const links = getExternalLinks(
      event({
        officialEventUrl: "https://www.hangaren.dk/events/kander",
        ticketUrl: "https://ra.co/events/2461529",
        canonicalSourceId: "src-hangaren",
      }),
    );
    expect(links).toEqual([
      { label: "Official event", href: "https://www.hangaren.dk/events/kander", primary: true },
      { label: "Tickets", href: "https://ra.co/events/2461529", primary: false },
    ]);
  });

  it("4. identical normalized official + ticket URLs -> one correctly-classified link only, never both labels", () => {
    const links = getExternalLinks(
      event({
        officialEventUrl: "https://billetto.dk/e/zoumer-billetter-1926030?utm_campaign=websites",
        ticketUrl: "https://billetto.dk/e/zoumer-billetter-1926030?utm_source=other",
        canonicalSourceId: "src-billetto",
      }),
    );
    expect(links).toHaveLength(1);
    expect(links[0].label).toBe("Tickets");
  });

  it("5. source/discovery URL with no verified first-party or ticketing role -> not mislabeled as either", () => {
    const links = getExternalLinks(
      event({ officialEventUrl: "https://ra.co/copenhagen/events", canonicalSourceId: "src-ra-copenhagen" }),
    );
    expect(links).toEqual([{ label: "Source", href: "https://ra.co/copenhagen/events", primary: true }]);
  });

  it("6. Zoumer reference case -> TICKETS for the Billetto link, not Official event", () => {
    const zoumerUrl = "https://billetto.dk/e/zoumer-billetter-1926030?utm_campaign=websites&utm_content=DK+7354292";
    const links = getExternalLinks(
      event({ officialEventUrl: zoumerUrl, ticketUrl: zoumerUrl, canonicalSourceId: "src-billetto" }),
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ label: "Tickets", href: zoumerUrl, primary: true });
    expect(links.some((l) => l.label === "Official event")).toBe(false);
  });

  it("7. venue first-party page + Billetto ticket page (distinct URLs, multi-source) -> OFFICIAL EVENT + TICKETS", () => {
    const links = getExternalLinks(
      event({
        officialEventUrl: "https://www.hangaren.dk/events/some-show",
        ticketUrl: "https://billetto.dk/e/some-show-billetter-1",
        canonicalSourceId: "src-hangaren",
      }),
    );
    expect(links).toEqual([
      { label: "Official event", href: "https://www.hangaren.dk/events/some-show", primary: true },
      { label: "Tickets", href: "https://billetto.dk/e/some-show-billetter-1", primary: false },
    ]);
  });

  it("9. malformed/ambiguous URL -> safe behavior (no throw, link still shown)", () => {
    expect(() => getExternalLinks(event({ officialEventUrl: "not a url", canonicalSourceId: "src-billetto" }))).not.toThrow();
    const links = getExternalLinks(event({ officialEventUrl: "not a url", canonicalSourceId: "src-billetto" }));
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe("not a url");
  });

  it("10. an admin-added event (no canonicalSourceId) keeps 'Official event' — a human already vouched for it", () => {
    const links = getExternalLinks(event({ officialEventUrl: "https://example.com/real-page", canonicalSourceId: null }));
    expect(links[0]).toEqual({ label: "Official event", href: "https://example.com/real-page", primary: true });
  });

  it("an unresolvable canonicalSourceId doesn't downgrade what's already stored", () => {
    const links = getExternalLinks(event({ officialEventUrl: "https://example.com/x", canonicalSourceId: "src-does-not-exist" }));
    expect(links[0].label).toBe("Official event");
  });
});

describe("FREE admission CTA", () => {
  it("requires positive free-admission evidence (priceFrom === 0) — missing price data alone is never FREE", () => {
    expect(isFreeAdmission(event({ priceFrom: null }))).toBe(false);
    expect(isFreeAdmission(event({ priceFrom: 0 }))).toBe(true);
    expect(isFreeAdmission(event({ priceFrom: 100 }))).toBe(false);
  });

  it("hasTicketDestination is true for either a ticketUrl or a Resident Advisor link", () => {
    expect(hasTicketDestination(event())).toBe(false);
    expect(hasTicketDestination(event({ ticketUrl: "https://billetto.dk/e/x" }))).toBe(true);
    expect(hasTicketDestination(event({ residentAdvisorUrl: "https://ra.co/events/1" }))).toBe(true);
  });

  it("shows FREE only when there is no ticket destination AND free-admission evidence exists", () => {
    expect(showFreeCta(event({ priceFrom: 0 }))).toBe(true);
    expect(showFreeCta(event({ priceFrom: null }))).toBe(false); // missing ticket URL alone must never imply FREE
    expect(showFreeCta(event({ priceFrom: 0, ticketUrl: "https://billetto.dk/e/x" }))).toBe(false); // an actual ticket link still wins
    expect(showFreeCta(event({ priceFrom: 0, residentAdvisorUrl: "https://ra.co/events/1" }))).toBe(false);
  });
});
