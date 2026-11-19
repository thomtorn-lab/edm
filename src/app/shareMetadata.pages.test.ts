import { describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { FALLBACK_SHARE_IMAGE } from "@/lib/shareMetadata";

// The page modules are imported only for their metadata; their data
// dependencies are stubbed the same way the pages' own tests do.
vi.mock("@/lib/queries", () => ({
  getUpcomingPublishedEventsForList: vi.fn(),
  getPreviewAvailabilityForEvents: vi.fn(),
  getSoundcloudAvailabilityForEvents: vi.fn(),
}));
vi.mock("@/components/NewsletterSignupForm", () => ({ default: () => null }));
vi.mock("@/db/artistAppearances", () => ({ listFollowableArtists: vi.fn() }));
vi.mock("@/db/newsletter", () => ({}));
vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "font-inter", className: "font-inter" }) }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-big-shoulders", className: "font-big-shoulders" }) }));

/**
 * Link-preview metadata for the home page and the static pages (2026-11-19):
 * every page keeps its existing <title>, meta description and canonical, and
 * now also carries a canonical og:url, site name, locale, a large Twitter
 * card and the approved fallback image.
 */
const PAGES: Array<{ route: string; load: () => Promise<Metadata>; title: Metadata["title"]; shareTitle: string; description: string }> = [
  {
    route: "/",
    load: async () => (await import("./page")).metadata,
    title: undefined,
    shareTitle: "Electronic CPH — Copenhagen Electronic Music Events",
    description: "Techno, house, trance, drum & bass and more — a fast, curated index of electronic music events in Copenhagen.",
  },
  {
    route: "/venues",
    load: async () => (await import("./venues/page")).metadata,
    title: "Venues",
    shareTitle: "Venues — Electronic CPH",
    description: "A curated guide to Copenhagen venues where electronic music is the main focus: Culture Box, Hangaren, Den Anden Side, MODULE and more.",
  },
  {
    route: "/festivals",
    load: async () => (await import("./festivals/page")).metadata,
    title: "Festivals",
    shareTitle: "Festivals — Electronic CPH",
    description: "A curated guide to the European electronic music festivals most worth knowing about, from Tomorrowland to Dekmantel.",
  },
  {
    route: "/about",
    load: async () => (await import("./about/page")).metadata,
    title: "About",
    shareTitle: "About — Electronic CPH",
    description: "What Electronic CPH is and what it covers.",
  },
  {
    route: "/artists",
    load: async () => (await import("./artists/page")).generateMetadata(),
    title: "Artists",
    shareTitle: "Artists — Electronic CPH",
    description: "Follow your favourite artists and get an email when they play in Copenhagen.",
  },
  {
    route: "/contact",
    load: async () => (await import("./contact/page")).metadata,
    title: "Contact",
    shareTitle: "Contact — Electronic CPH",
    description: "Get in touch with Electronic CPH — corrections, tips, and general questions.",
  },
  {
    route: "/suggest-event",
    load: async () => (await import("./suggest-event/page")).metadata,
    title: "Suggest an event",
    shareTitle: "Suggest an event — Electronic CPH",
    description: "Know a Copenhagen electronic music event that's missing? Suggest it for review.",
  },
  {
    route: "/privacy",
    load: async () => (await import("./privacy/page")).metadata,
    title: "Privacy",
    shareTitle: "Privacy — Electronic CPH",
    description:
      "How Electronic CPH handles personal data: hosting, visitor statistics only with your consent, YouTube videos loaded only when you press play, and the contact forms.",
  },
];

describe("link-preview metadata — home and static pages", () => {
  for (const page of PAGES) {
    it(`${page.route}: keeps its title, description and canonical, and gets the full share set with the fallback image`, async () => {
      const m = await page.load();
      expect(m.title).toEqual(page.title);
      // The home page inherits the layout's description rather than setting its own.
      if (page.route !== "/") expect(m.description).toBe(page.description);
      expect(m.alternates).toEqual({ canonical: page.route });
      expect(m.openGraph).toEqual({
        type: "website",
        siteName: "Electronic CPH",
        locale: "en_GB",
        url: page.route,
        title: page.shareTitle,
        description: page.description,
        images: [FALLBACK_SHARE_IMAGE],
      });
      expect(m.twitter).toEqual({
        card: "summary_large_image",
        title: page.shareTitle,
        description: page.description,
        images: [{ url: FALLBACK_SHARE_IMAGE.url, alt: FALLBACK_SHARE_IMAGE.alt }],
      });
    });
  }

  it("the root layout keeps its title/description and gives every other page the fallback image and a large card, without guessing an og:url", async () => {
    const { metadata } = await import("./layout");
    expect(metadata.title).toEqual({ default: "Electronic CPH — Copenhagen Electronic Music Events", template: "%s — Electronic CPH" });
    expect(metadata.description).toBe(PAGES[0].description);
    expect(metadata.openGraph).toEqual({ type: "website", siteName: "Electronic CPH", locale: "en_GB", images: [FALLBACK_SHARE_IMAGE] });
    expect(metadata.twitter).toEqual({ card: "summary_large_image", images: [{ url: FALLBACK_SHARE_IMAGE.url, alt: FALLBACK_SHARE_IMAGE.alt }] });
  });
});
