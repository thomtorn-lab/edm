import { describe, expect, it } from "vitest";
import { getExternalLinks, getSourceProvenance, hasTicketDestination, isFreeAdmission, showFreeCta } from "./links";
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
    subVenue: null,
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

describe("getExternalLinks — Source CTA visibility rule (public source-link visibility work package, 2026-09-07)", () => {
  // SOURCE is a CTA fallback only: it must never appear as an equal
  // alternative next to a genuine Official event/Tickets destination, but
  // remains the CTA when it's the only usable public link. src-kultunaut is
  // a real discovery/aggregator source (officialUrlRole "unknown" ->
  // "Source"); src-hangaren is official-venue; src-billetto is ticketing.

  it("1. Source only -> Source CTA visible", () => {
    const links = getExternalLinks(
      event({ officialEventUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1", canonicalSourceId: "src-kultunaut" }),
    );
    expect(links).toEqual([{ label: "Source", href: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1", primary: true }]);
  });

  it("2. Official event + Source -> only Official event CTA visible", () => {
    const links = getExternalLinks(
      event({
        officialEventUrl: "https://www.hangaren.dk/events/x",
        canonicalSourceId: "src-hangaren",
        otherSourceUrls: ["https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=2"],
      }),
    );
    expect(links).toEqual([{ label: "Official event", href: "https://www.hangaren.dk/events/x", primary: true }]);
    expect(links.some((l) => l.label === "Source")).toBe(false);
  });

  it("3. Tickets + Source -> only Tickets CTA visible", () => {
    const links = getExternalLinks(
      event({
        ticketUrl: "https://billetto.dk/e/x",
        otherSourceUrls: ["https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=3"],
      }),
    );
    expect(links).toEqual([{ label: "Tickets", href: "https://billetto.dk/e/x", primary: false }]);
    expect(links.some((l) => l.label === "Source")).toBe(false);
  });

  it("4. Official event + Tickets + Source -> Official event + Tickets visible, Source CTA hidden", () => {
    const links = getExternalLinks(
      event({
        officialEventUrl: "https://www.hangaren.dk/events/x",
        canonicalSourceId: "src-hangaren",
        ticketUrl: "https://billetto.dk/e/x",
        otherSourceUrls: ["https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=4"],
      }),
    );
    expect(links).toEqual([
      { label: "Official event", href: "https://www.hangaren.dk/events/x", primary: true },
      { label: "Tickets", href: "https://billetto.dk/e/x", primary: false },
    ]);
    expect(links.some((l) => l.label === "Source")).toBe(false);
  });

  it("5. Official event + Tickets, no Source -> unchanged from existing behavior", () => {
    const links = getExternalLinks(
      event({
        officialEventUrl: "https://www.hangaren.dk/events/x",
        canonicalSourceId: "src-hangaren",
        ticketUrl: "https://billetto.dk/e/x",
      }),
    );
    expect(links).toEqual([
      { label: "Official event", href: "https://www.hangaren.dk/events/x", primary: true },
      { label: "Tickets", href: "https://billetto.dk/e/x", primary: false },
    ]);
  });

  it("6. same-URL Official/Tickets collapse still happens before Source suppression is applied", () => {
    const zoumerUrl = "https://billetto.dk/e/zoumer-billetter-1926030?utm_campaign=websites";
    const links = getExternalLinks(
      event({
        officialEventUrl: zoumerUrl,
        ticketUrl: zoumerUrl,
        canonicalSourceId: "src-billetto",
        otherSourceUrls: ["https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=6"],
      }),
    );
    expect(links).toEqual([{ label: "Tickets", href: zoumerUrl, primary: true }]);
  });

  it("no usable links at all -> empty CTA list (rule E)", () => {
    expect(getExternalLinks(event())).toEqual([]);
  });

  it("Source suppression composes correctly with EventRow's max=2 truncation (Official + Tickets + Source with a cap of 2)", () => {
    const links = getExternalLinks(
      event({
        officialEventUrl: "https://www.hangaren.dk/events/x",
        canonicalSourceId: "src-hangaren",
        ticketUrl: "https://billetto.dk/e/x",
        otherSourceUrls: ["https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=7"],
      }),
      2,
    );
    expect(links.map((l) => l.label)).toEqual(["Official event", "Tickets"]);
  });

  it("12. is a pure read of the event — never mutates the input (no source_event_links/otherSourceUrls mutation)", () => {
    const input = event({
      officialEventUrl: "https://www.hangaren.dk/events/x",
      canonicalSourceId: "src-hangaren",
      otherSourceUrls: ["https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1"],
    });
    const snapshot = JSON.parse(JSON.stringify(input));
    getExternalLinks(input);
    getSourceProvenance(input);
    expect(input).toEqual(snapshot);
  });

  it("14. does not regress source-role classification — a ticketing source's link is still 'Tickets', not 'Source', even once suppression exists", () => {
    const links = getExternalLinks(event({ officialEventUrl: "https://billetto.dk/e/x", canonicalSourceId: "src-billetto" }));
    expect(links).toEqual([{ label: "Tickets", href: "https://billetto.dk/e/x", primary: true }]);
  });
});

describe("getSourceProvenance — discreet public provenance (detail page only, public source-link visibility work package, 2026-09-07)", () => {
  it("identifies the actual source by name for a discovery/aggregator-sourced event (Jasho Club // Poolen Outside reference shape)", () => {
    const provenance = getSourceProvenance(
      event({ officialEventUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20137664", canonicalSourceId: "src-kultunaut" }),
    );
    expect(provenance).toEqual({ sourceName: "KultuNaut — Elektronisk / Club-DJ (Kbh. og Frederiksberg)", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20137664" });
  });

  it("returns null for a genuine first-party official-venue source — no separate 'Source' identity to surface", () => {
    expect(getSourceProvenance(event({ officialEventUrl: "https://www.hangaren.dk/events/x", canonicalSourceId: "src-hangaren" }))).toBeNull();
  });

  it("returns null for a ticketing source — Tickets already identifies the destination clearly enough", () => {
    expect(getSourceProvenance(event({ officialEventUrl: "https://billetto.dk/e/x", canonicalSourceId: "src-billetto" }))).toBeNull();
  });

  it("returns null when there is no officialEventUrl at all", () => {
    expect(getSourceProvenance(event({ officialEventUrl: null, canonicalSourceId: "src-kultunaut" }))).toBeNull();
  });

  it("returns null for an admin-added event with no canonicalSourceId — never invents a source name", () => {
    expect(getSourceProvenance(event({ officialEventUrl: "https://example.com/x", canonicalSourceId: null }))).toBeNull();
  });

  it("never exposes internal fields — the returned shape is exactly {sourceName, sourceUrl}, never a source id, trust level, or confidence", () => {
    const provenance = getSourceProvenance(
      event({ officialEventUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1", canonicalSourceId: "src-kultunaut" }),
    );
    expect(provenance && Object.keys(provenance).sort()).toEqual(["sourceName", "sourceUrl"]);
  });

  it("10. multiple-source deterministic rule: a secondary, non-canonical source_event_links match (e.g. a KultuNaut duplicate layered onto an already-canonical Poolen event) is never surfaced — only the event's own canonical source decides public provenance", () => {
    // Real Production shape (13 published events confirmed live): the
    // canonical source is the official venue, and otherSourceUrls carries a
    // secondary, non-canonical KultuNaut match. Canonical authority alone
    // decides — the secondary source never appears here.
    const provenance = getSourceProvenance(
      event({
        officialEventUrl: "https://poolen.dk/da/koncerter/example/",
        canonicalSourceId: "src-poolen",
        otherSourceUrls: ["https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1"],
      }),
    );
    expect(provenance).toBeNull();
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
