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

describe("getExternalLinks — KultuNaut role integrity (admin + public link integrity, 2026-09-08)", () => {
  const kultunautUrl = "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20137632";

  it("1/2/3. canonical KultuNaut, untouched officialEventUrl (its own page, the sync default) -> Source only, never Official event or Tickets", () => {
    const links = getExternalLinks(event({ officialEventUrl: kultunautUrl, canonicalSourceId: "src-kultunaut" }));
    expect(links).toEqual([{ label: "Source", href: kultunautUrl, primary: true }]);
  });

  it("4. canonical KultuNaut + a distinct external real ticket URL -> Tickets CTA, KultuNaut itself never promoted", () => {
    const links = getExternalLinks(
      event({ officialEventUrl: kultunautUrl, ticketUrl: "https://billetto.dk/e/nico-moreno-123", canonicalSourceId: "src-kultunaut" }),
    );
    expect(links).toEqual([{ label: "Tickets", href: "https://billetto.dk/e/nico-moreno-123", primary: false }]);
  });

  it("5. canonical KultuNaut + a MANUAL (overriddenFields-tracked) officialEventUrl -> Official event CTA, not downgraded to Source by canonicalSourceId", () => {
    const links = getExternalLinks(
      event({
        officialEventUrl: "https://official-venue.dk/event/xyz",
        canonicalSourceId: "src-kultunaut",
        overriddenFields: ["officialEventUrl"],
      }),
    );
    expect(links).toEqual([{ label: "Official event", href: "https://official-venue.dk/event/xyz", primary: true }]);
  });

  it("5b. the SAME manual officialEventUrl also survives when the event additionally has a ticketUrl — this was the literal 'link disappears' bug: Source-labeled entries get stripped whenever a Tickets/RA CTA exists, and an unfixed officialUrlRole mislabels a manual override as Source", () => {
    const links = getExternalLinks(
      event({
        officialEventUrl: "https://official-venue.dk/event/xyz",
        ticketUrl: "https://billetto.dk/e/nico-moreno-123",
        canonicalSourceId: "src-kultunaut",
        overriddenFields: ["officialEventUrl"],
      }),
    );
    expect(links).toEqual([
      { label: "Official event", href: "https://official-venue.dk/event/xyz", primary: true },
      { label: "Tickets", href: "https://billetto.dk/e/nico-moreno-123", primary: false },
    ]);
  });

  it("6. canonical KultuNaut + manual ticketUrl -> Tickets CTA (already correct before this fix — ticketUrl is never role-classified by source — regression guard)", () => {
    const links = getExternalLinks(
      event({ ticketUrl: "https://billetto.dk/e/manual-ticket", canonicalSourceId: "src-kultunaut", overriddenFields: ["ticketUrl"] }),
    );
    expect(links).toEqual([{ label: "Tickets", href: "https://billetto.dk/e/manual-ticket", primary: false }]);
  });

  it("14. bad historical same-URL data (ticketUrl literally equals the KultuNaut page URL) never renders as Tickets — collapses to the correctly-classified Source entry only", () => {
    const links = getExternalLinks(
      event({ officialEventUrl: kultunautUrl, ticketUrl: kultunautUrl, canonicalSourceId: "src-kultunaut" }),
    );
    expect(links).toEqual([{ label: "Source", href: kultunautUrl, primary: true }]);
    expect(links.some((l) => l.label === "Tickets")).toBe(false);
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
    expect(input).toEqual(snapshot);
  });

  it("14. does not regress source-role classification — a ticketing source's link is still 'Tickets', not 'Source', even once suppression exists", () => {
    const links = getExternalLinks(event({ officialEventUrl: "https://billetto.dk/e/x", canonicalSourceId: "src-billetto" }));
    expect(links).toEqual([{ label: "Tickets", href: "https://billetto.dk/e/x", primary: true }]);
  });
});

describe("getSourceProvenance — discreet public provenance (detail page only; revised 2026-09-07 to read source_event_links, not only canonicalSourceId)", () => {
  // getSourceProvenance now takes the event's real source_event_links rows
  // ({sourceId, sourceUrl, role}), not the event object — see its own doc
  // comment in links.ts for why the earlier canonical-only design was too
  // narrow (it silently dropped a secondary discovery match on an otherwise
  // official-venue/ticketing canonical event).

  it("identifies a source-only discovery/aggregator event by its clean brand name (Jasho Club // Poolen Outside reference shape)", () => {
    const provenance = getSourceProvenance([
      { sourceId: "src-kultunaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20137664", role: "official" },
    ]);
    expect(provenance).toEqual([{ sourceName: "KultuNaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=20137664" }]);
  });

  it("1. official canonical (Poolen) + secondary discovery match (KultuNaut) -> KultuNaut provenance visible, even though an Official event CTA also shows", () => {
    // Real Production shape (13 published events confirmed live): canonical
    // official-venue source + a secondary KultuNaut source_event_links row
    // from db/sync.ts's match branch. This is exactly the case the
    // canonical-only design used to miss.
    const provenance = getSourceProvenance([
      { sourceId: "src-poolen", sourceUrl: "https://poolen.dk/da/koncerter/example/", role: "official" },
      { sourceId: "src-kultunaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1", role: "official" },
    ]);
    expect(provenance).toEqual([{ sourceName: "KultuNaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1" }]);
  });

  it("2. official-venue and ticketing sources are never listed as provenance themselves — already shown as Official event/Tickets", () => {
    expect(getSourceProvenance([{ sourceId: "src-hangaren", sourceUrl: "https://www.hangaren.dk/events/x", role: "official" }])).toEqual([]);
    expect(getSourceProvenance([{ sourceId: "src-billetto", sourceUrl: "https://billetto.dk/e/x", role: "official" }])).toEqual([]);
  });

  it("3. canonical KultuNaut (with a separate Tickets destination elsewhere) -> KultuNaut provenance still resolves", () => {
    const provenance = getSourceProvenance([
      { sourceId: "src-kultunaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=2", role: "official" },
    ]);
    expect(provenance).toEqual([{ sourceName: "KultuNaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=2" }]);
  });

  it("4. multiple qualifying discovery sources -> compact, deterministically ordered, deduplicated-by-source list", () => {
    const provenance = getSourceProvenance([
      { sourceId: "src-kultunaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=3", role: "official" },
      { sourceId: "src-eventbrite", sourceUrl: "https://www.eventbrite.dk/e/example", role: "official" },
      // A duplicate row for a source already recorded "official" (e.g. a
      // later re-sync also wrote an "other" row) must not produce a second
      // entry, and must not displace the preferred "official" URL.
      { sourceId: "src-kultunaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=3-alt", role: "other" },
    ]);
    expect(provenance).toEqual([
      { sourceName: "Eventbrite", sourceUrl: "https://www.eventbrite.dk/e/example" },
      { sourceName: "KultuNaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=3" },
    ]);
  });

  it("5. public display name is a clean brand name, never the internal registry sourceName's feed-specific detail", () => {
    const provenance = getSourceProvenance([
      { sourceId: "src-kultunaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1", role: "official" },
    ]);
    expect(provenance[0].sourceName).toBe("KultuNaut");
    expect(provenance[0].sourceName).not.toContain("Elektronisk");
  });

  it("returns an empty array when there are no source_event_links rows at all (e.g. an admin-added event)", () => {
    expect(getSourceProvenance([])).toEqual([]);
  });

  it("skips a link whose sourceId doesn't resolve in the registry, rather than throwing", () => {
    expect(() => getSourceProvenance([{ sourceId: "src-does-not-exist", sourceUrl: "https://example.com/x", role: "official" }])).not.toThrow();
    expect(getSourceProvenance([{ sourceId: "src-does-not-exist", sourceUrl: "https://example.com/x", role: "official" }])).toEqual([]);
  });

  it("never exposes internal fields — each entry is exactly {sourceName, sourceUrl}, never a source id, trust level, or confidence", () => {
    const provenance = getSourceProvenance([
      { sourceId: "src-kultunaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1", role: "official" },
    ]);
    expect(Object.keys(provenance[0]).sort()).toEqual(["sourceName", "sourceUrl"]);
  });

  it("is a pure read of its input — never mutates the source_event_links rows passed in", () => {
    const input = [{ sourceId: "src-kultunaut", sourceUrl: "https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=1", role: "official" }];
    const snapshot = JSON.parse(JSON.stringify(input));
    getSourceProvenance(input);
    expect(input).toEqual(snapshot);
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

describe("getExternalLinks — Facebook decision (unified event create/edit model, 2026-09-08): Facebook is never its own public link role", () => {
  it("renders a Facebook URL as Official event when officialEventUrl is unset — 'if a Facebook URL is the official event page, use it as Official Event URL'", () => {
    const links = getExternalLinks(event({ officialEventUrl: null, facebookUrl: "https://facebook.com/events/123" }));
    expect(links).toEqual([{ label: "Official event", href: "https://facebook.com/events/123", primary: true }]);
  });

  it("never shows a separate Facebook CTA once a real officialEventUrl exists — no third chip alongside Official event/Tickets", () => {
    const links = getExternalLinks(
      event({ officialEventUrl: "https://venue.dk/event/1", ticketUrl: "https://billetto.dk/e/x", facebookUrl: "https://facebook.com/events/123" }),
    );
    expect(links.map((l) => l.label)).toEqual(["Official event", "Tickets"]);
    expect(links.some((l) => l.href === "https://facebook.com/events/123")).toBe(false);
  });

  it("a Facebook fallback never gets suppressed by the Source-suppression rule the way a genuine 'Source' entry would — it renders as a real primary destination", () => {
    const links = getExternalLinks(event({ officialEventUrl: null, facebookUrl: "https://facebook.com/events/123", ticketUrl: "https://billetto.dk/e/x" }));
    expect(links.map((l) => l.label).sort()).toEqual(["Official event", "Tickets"]);
    expect(links.find((l) => l.label === "Official event")).toEqual({ label: "Official event", href: "https://facebook.com/events/123", primary: true });
  });

  it("no facebookUrl and no officialEventUrl: no Official event entry at all (nothing to fall back to)", () => {
    const links = getExternalLinks(event({ officialEventUrl: null, facebookUrl: null, ticketUrl: "https://billetto.dk/e/x" }));
    expect(links.map((l) => l.label)).toEqual(["Tickets"]);
  });
});
