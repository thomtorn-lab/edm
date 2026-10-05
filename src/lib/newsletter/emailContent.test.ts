import { describe, expect, it } from "vitest";
import { buildManageUrl, buildNewsletterEmail, buildUnsubscribeUrl } from "./emailContent";
import type { EventWithVenue } from "../queries";
import type { GenreSlug, MainGenreSlug } from "../taxonomy";

const VENUE = {
  id: "v-test",
  slug: "culture-box",
  name: "Culture Box",
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
    startDatetime: "2026-10-10T20:00:00.000Z",
    endDatetime: null,
    timezone: "Europe/Copenhagen",
    venueId: VENUE.id,
    subVenue: null,
    primaryGenre: "techno",
    subgenres: ["techno"] as GenreSlug[],
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

describe("buildManageUrl / buildUnsubscribeUrl", () => {
  it("embeds the manage token in both URLs", () => {
    expect(buildManageUrl("tok123")).toContain("tok123");
    expect(buildUnsubscribeUrl("tok123")).toContain("tok123");
  });

  it("the unsubscribe URL points at the API route, the manage URL at the page", () => {
    expect(buildUnsubscribeUrl("tok123")).toContain("/api/newsletter/unsubscribe");
    expect(buildManageUrl("tok123")).toContain("/newsletter/manage");
  });
});

describe("buildNewsletterEmail", () => {
  it("lists every event's title, venue, and a link to its event page", () => {
    const { html, text } = buildNewsletterEmail({
      genres: [],
      events: [makeEvent({ title: "Warehouse Night", slug: "warehouse-night" })],
      manageToken: "tok",
    });
    expect(html).toContain("Warehouse Night");
    expect(html).toContain("Culture Box");
    expect(html).toContain("/events/warehouse-night");
    expect(text).toContain("Warehouse Night");
    expect(text).toContain("/events/warehouse-night");
  });

  it("marks a sold-out event clearly, distinct from a normal one", () => {
    const { html, text } = buildNewsletterEmail({
      genres: [],
      events: [makeEvent({ soldOut: true, title: "Sold Out Night" })],
      manageToken: "tok",
    });
    expect(html).toContain("Sold Out Night");
    expect(html).toContain("Sold out");
    expect(text).toContain("Sold out");
  });

  it("shows both genres in PRIMARY, SECONDARY order for a two-genre event", () => {
    const { html } = buildNewsletterEmail({
      genres: [],
      events: [makeEvent({ primaryGenre: "techno", subgenres: ["techno", "melodic-techno"] as GenreSlug[] })],
      manageToken: "tok",
    });
    expect(html).toContain("Techno · Melodic Techno");
  });

  it("includes a scope line reflecting the subscriber's selected genres", () => {
    const { html, text } = buildNewsletterEmail({ genres: ["techno", "house"] as MainGenreSlug[], events: [], manageToken: "tok" });
    expect(html).toContain("Techno, House");
    expect(text).toContain("Techno, House");
  });

  it("shows 'All genres' when the subscriber has no genre selection", () => {
    const { html } = buildNewsletterEmail({ genres: [], events: [], manageToken: "tok" });
    expect(html).toContain("All genres");
  });

  it("includes a manage-preferences link and an unsubscribe link in both html and text", () => {
    const { html, text } = buildNewsletterEmail({ genres: [], events: [], manageToken: "tok-xyz" });
    expect(html).toContain("tok-xyz");
    expect(html).toMatch(/Manage preferences/);
    expect(html).toMatch(/Unsubscribe/);
    expect(text).toContain("tok-xyz");
    expect(text).toMatch(/Manage preferences/);
    expect(text).toMatch(/Unsubscribe/);
  });

  it("escapes event titles containing HTML-significant characters", () => {
    const { html } = buildNewsletterEmail({
      genres: [],
      events: [makeEvent({ title: "Rock & Roll <Night>" })],
      manageToken: "tok",
    });
    expect(html).toContain("Rock &amp; Roll &lt;Night&gt;");
    expect(html).not.toContain("<Night>");
  });

  it("produces no event rows (but still a valid email) when the event list is empty", () => {
    const { html, text } = buildNewsletterEmail({ genres: [], events: [], manageToken: "tok" });
    expect(html).toContain("Electronic CPH");
    expect(text).toContain("Electronic CPH");
  });

  it("lists multiple events in the order given (callers are responsible for chronological ordering)", () => {
    const { text } = buildNewsletterEmail({
      genres: [],
      events: [makeEvent({ id: "e-1", title: "First" }), makeEvent({ id: "e-2", title: "Second" })],
      manageToken: "tok",
    });
    expect(text.indexOf("First")).toBeLessThan(text.indexOf("Second"));
  });

  it("uses a static, non-sensational subject line", () => {
    const { subject } = buildNewsletterEmail({ genres: [], events: [], manageToken: "tok" });
    expect(subject).toBe("This week in Copenhagen electronic music");
  });
});
