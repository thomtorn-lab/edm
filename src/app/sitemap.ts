import type { MetadataRoute } from "next";
import { getPublishedEventsWithVenue, getVenues } from "@/lib/queries";
import { FESTIVALS } from "@/lib/data/festivals";
import { getPublicVenueGroupPrimaryId } from "@/lib/data/venues";

// Forced request-time (build-time DB dependency audit, 2026-09-07): without
// this, Next.js prerenders this route at BUILD time by default, so the
// queries below would run against whatever database DATABASE_URL points to
// during the Vercel build itself — and a schema change that adds a column
// selected by events/venues queries (src/lib/queries.ts) but not yet
// migrated onto that same database fails the ENTIRE build with a Postgres
// "column does not exist" error (this happened three times live: the
// sub_venue column, the admin_unpublish_reason/admin_unpublished_at
// columns, and admin_unpublish_note, all 2026-09-06/07). `revalidate = 0`
// removes this route from the build-time prerender path entirely — the
// same pattern already used by every other DB-touching route in this app
// (src/app/page.tsx, venues/page.tsx, venues/[slug]/page.tsx,
// events/[slug]/page.tsx, admin/page.tsx) — so a lagging migration can only
// ever 500 a single sitemap request until it lands, never block the build.
export const revalidate = 0;

const SITE_URL = "https://electroniccph.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/venues`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/festivals`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/suggest-event`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.1 },
  ];

  const [publishedEvents, venues] = await Promise.all([getPublishedEventsWithVenue(), getVenues()]);

  const eventRoutes: MetadataRoute.Sitemap = publishedEvents.map((event) => ({
    url: `${SITE_URL}/events/${event.slug}`,
    lastModified: new Date(event.updatedAt),
    changeFrequency: "daily",
    priority: 0.8,
  }));

  // A grouped member (VEGA overall-venue presentation, 2026-09-11 — e.g.
  // Ideal Bar) now permanently redirects to its group's primary URL
  // (src/app/venues/[slug]/page.tsx) rather than rendering its own page —
  // excluded here so the sitemap never lists a URL that immediately
  // redirects away from itself.
  const venueRoutes: MetadataRoute.Sitemap = venues
    .filter((venue) => !getPublicVenueGroupPrimaryId(venue.id))
    .map((venue) => ({
      url: `${SITE_URL}/venues/${venue.slug}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    }));

  const festivalRoutes: MetadataRoute.Sitemap = FESTIVALS.map((festival) => ({
    url: `${SITE_URL}/festivals/${festival.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.4,
  }));

  return [...staticRoutes, ...eventRoutes, ...venueRoutes, ...festivalRoutes];
}
