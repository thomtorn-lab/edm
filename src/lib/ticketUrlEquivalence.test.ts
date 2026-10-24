import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapBillettoEvent } from "./adapters/billettoAdapter";
import { parsePoolenProgramHtml } from "./adapters/poolenAdapter";
import type { RawCandidateEvent } from "./adapters/types";
import { stripOverriddenFields } from "./override";
import { buildSyncPatch, type SyncTargetEvent } from "./sync";
import { ticketUrlsEquivalent } from "./ticketUrlEquivalence";

const FIXTURES = path.join(__dirname, "adapters", "__fixtures__");

// The one event the ticket-link history (2026-10-23) shows alternating 316
// times between Poolen and Billetto: both point at Billetto event 1879852,
// each with its own tracking parameters.
const POOLEN_HTML = readFileSync(path.join(FIXTURES, "poolen-program.html"), "utf-8");
const POOLEN_URL = parsePoolenProgramHtml(POOLEN_HTML).find((e) => /infected mushroom/i.test(e.title))!.ticketUrl!;
const POOLEN_URL_UNDECODED = POOLEN_HTML.match(/href="(https:\/\/billetto\.dk\/e\/infected-mushroom[^"]+)"/)![1];
const BILLETTO_URL = mapBillettoEvent(JSON.parse(readFileSync(path.join(FIXTURES, "billetto-events.json"), "utf-8")).infectedMushroom)!.ticketUrl!;

describe("the real Poolen/Billetto fixtures", () => {
  it("are what the history analysis saw: the same Billetto event with different tracking parameters", () => {
    expect(POOLEN_URL).toBe("https://billetto.dk/e/infected-mushroom-30th-anniversary-tour-billetter-1879852?utm_source=organiser&utm_medium=share&utm_campaign=copy_link&utm_content=1");
    expect(POOLEN_URL_UNDECODED).toContain("&#038;");
    expect(BILLETTO_URL).toMatch(/^https:\/\/billetto\.dk\/e\/infected-mushroom-30th-anniversary-tour-billetter-1879852\?.*utm_medium=publishers/);
  });

  it("are NOT treated as equivalent: Billetto's publisher parameters may be partner attribution", () => {
    expect(ticketUrlsEquivalent(POOLEN_URL, BILLETTO_URL)).toBe(false);
  });

  it("an HTML-escaped link is NOT equivalent to its decoded form (the escaped one is broken)", () => {
    expect(ticketUrlsEquivalent(POOLEN_URL_UNDECODED, POOLEN_URL)).toBe(false);
  });

  it("the same fixture link in a functionally identical spelling is equivalent", () => {
    const respelled = ` ${POOLEN_URL.replace("https://billetto.dk/", "HTTPS://Billetto.DK:443/")} `;
    expect(ticketUrlsEquivalent(respelled, POOLEN_URL)).toBe(true);
  });
});

describe("ticketUrlsEquivalent — cosmetic differences (equivalent)", () => {
  it.each([
    ["identical", "https://billetto.dk/e/x-1", "https://billetto.dk/e/x-1"],
    ["host case", "https://Billetto.DK/e/x-1", "https://billetto.dk/e/x-1"],
    ["scheme case", "HTTPS://billetto.dk/e/x-1", "https://billetto.dk/e/x-1"],
    ["explicit default https port", "https://billetto.dk:443/e/x-1", "https://billetto.dk/e/x-1"],
    ["explicit default http port", "http://example.com:80/t", "http://example.com/t"],
    ["surrounding whitespace", "  https://billetto.dk/e/x-1\n", "https://billetto.dk/e/x-1"],
    ["empty path vs /", "https://tickets.example", "https://tickets.example/"],
  ])("%s", (_, a, b) => {
    expect(ticketUrlsEquivalent(a, b)).toBe(true);
    expect(ticketUrlsEquivalent(b, a)).toBe(true);
  });
});

describe("ticketUrlsEquivalent — meaningful or uncertain differences (not equivalent, today's behaviour kept)", () => {
  it.each([
    ["different utm values", "https://billetto.dk/e/x-1?utm_source=organiser", "https://billetto.dk/e/x-1?utm_source=billetto+advertising"],
    ["utm present vs absent", "https://billetto.dk/e/x-1?utm_campaign=websites", "https://billetto.dk/e/x-1"],
    ["affiliate parameter", "https://tickets.example/e/1?affiliate=abc", "https://tickets.example/e/1"],
    ["ref parameter", "https://tickets.example/e/1?ref=partner", "https://tickets.example/e/1"],
    ["promo/discount code", "https://www.tickster.com/e/1?c=6c52ydp", "https://www.tickster.com/e/1"],
    ["language/brand parameters", "https://www.ticketmaster.dk/event/1665380278?language=da-dk&brand=dk_livenation", "https://www.ticketmaster.dk/event/1665380278"],
    ["parameter order", "https://tickets.example/e?a=1&b=2", "https://tickets.example/e?b=2&a=1"],
    ["different event id", "https://ra.co/events/2554498", "https://ra.co/events/2554499"],
    ["language path prefix", "https://billetto.dk/en/e/x-1", "https://billetto.dk/e/x-1"],
    ["trailing slash on a path", "https://tickets.example/e/1/", "https://tickets.example/e/1"],
    ["www vs bare host", "https://www.billetto.dk/e/x-1", "https://billetto.dk/e/x-1"],
    ["http vs https", "http://billetto.dk/e/x-1", "https://billetto.dk/e/x-1"],
    ["path case", "https://tickets.example/E/1", "https://tickets.example/e/1"],
    ["fragment (room)", "https://culture-box.com/event/x/#red-box", "https://culture-box.com/event/x/#black-box"],
    ["fragment present vs absent", "https://culture-box.com/event/x/#red-box", "https://culture-box.com/event/x/"],
    ["percent-encoding", "https://tickets.example/e/a%20b", "https://tickets.example/e/a+b"],
    ["different host", "https://secure.tickster.com/abc", "https://www.tickster.com/abc"],
  ])("%s", (_, a, b) => {
    expect(ticketUrlsEquivalent(a, b)).toBe(false);
    expect(ticketUrlsEquivalent(b, a)).toBe(false);
  });

  it.each([
    ["null", null, "https://a.example/"],
    ["empty", "", "https://a.example/"],
    ["both null", null, null],
    ["relative", "/tickets", "/tickets"],
    ["not a URL", "not a url", "not a url"],
    ["non-http scheme", "mailto:tickets@example.com", "mailto:tickets@example.com"],
  ])("%s is never equivalent", (_, a, b) => {
    expect(ticketUrlsEquivalent(a, b)).toBe(false);
  });
});

describe("buildSyncPatch uses the rule only to skip identical spellings", () => {
  const base: SyncTargetEvent = {
    id: "e-im",
    title: "Infected Mushroom – 30th Anniversary Tour",
    description: null,
    artists: ["Infected Mushroom"],
    venueId: "v-poolen",
    subVenue: null,
    startDatetime: "2026-10-03T19:00:00.000Z",
    endDatetime: null,
    officialEventUrl: "https://poolen.dk/concerts/infected-mushroom/",
    ticketUrl: POOLEN_URL,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: null,
    primaryGenre: "psytrance",
    canonicalSourceId: "src-poolen",
    overriddenFields: [],
    soldOut: false,
    cancelled: false,
    postponed: false,
  };
  const raw = (ticketUrl: string | null): RawCandidateEvent => ({
    sourceId: "src-billetto",
    sourceUrl: BILLETTO_URL,
    title: base.title,
    description: null,
    artists: ["Infected Mushroom"],
    startDatetime: base.startDatetime,
    endDatetime: null,
    venueName: "Poolen",
    officialEventUrl: null,
    ticketUrl,
    facebookUrl: null,
    residentAdvisorUrl: null,
    imageUrl: null,
    priceFrom: null,
    genreHint: null,
    genreConfidenceHint: null,
  });
  const resolved = { resolvedVenueId: "v-poolen", normalizedArtists: ["Infected Mushroom"], genre: null, genreConfidence: "low" as const };

  it("functionally identical spelling: the stored link is left untouched", () => {
    const { patch } = buildSyncPatch(raw(POOLEN_URL.replace("https://billetto.dk/", "https://BILLETTO.dk:443/")), resolved, base);
    expect(patch).not.toHaveProperty("ticketUrl");
  });

  it("Poolen's and Billetto's real links still update each other exactly as today (behaviour preserved)", () => {
    expect(buildSyncPatch(raw(BILLETTO_URL), resolved, base).patch.ticketUrl).toBe(BILLETTO_URL);
    expect(buildSyncPatch(raw(POOLEN_URL), resolved, { ...base, ticketUrl: BILLETTO_URL }).patch.ticketUrl).toBe(POOLEN_URL);
  });

  it("a broken HTML-escaped stored link is still replaced by the decoded one", () => {
    expect(buildSyncPatch(raw(POOLEN_URL), resolved, { ...base, ticketUrl: POOLEN_URL_UNDECODED }).patch.ticketUrl).toBe(POOLEN_URL);
  });

  it("an empty stored link is still filled; a missing incoming link never clears", () => {
    expect(buildSyncPatch(raw(POOLEN_URL), resolved, { ...base, ticketUrl: null }).patch.ticketUrl).toBe(POOLEN_URL);
    expect(buildSyncPatch(raw(null), resolved, base).patch).not.toHaveProperty("ticketUrl");
  });

  it("admin overrides still win: an admin-set or admin-cleared link is never written by the sync", () => {
    const set = { ...base, ticketUrl: "https://tickets.example/admin-chosen", overriddenFields: ["ticketUrl"] };
    expect(stripOverriddenFields(buildSyncPatch(raw(BILLETTO_URL), resolved, set).patch, set.overriddenFields)).not.toHaveProperty("ticketUrl");
    const cleared = { ...base, ticketUrl: null, overriddenFields: ["ticketUrl"] };
    expect(stripOverriddenFields(buildSyncPatch(raw(BILLETTO_URL), resolved, cleared).patch, cleared.overriddenFields)).not.toHaveProperty("ticketUrl");
  });
});
