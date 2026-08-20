import { describe, expect, it } from "vitest";
import { getExternalLinks } from "./links";
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
