import type { MetadataRoute } from "next";
import { getPublishedEventsWithVenue, getVenues } from "@/lib/queries";
import { FESTIVALS } from "@/lib/data/festivals";

// Next.js prerenders this route at BUILD time by default (no `dynamic`
// export here), so the queries below run against whatever database
// DATABASE_URL points to during the Vercel build itself — not at request
// time. A schema change that adds a column selected by events/venues
// queries (src/lib/queries.ts) must have its migration applied to that
// same database BEFORE this code deploys, or the build fails here with a
// real Postgres "column does not exist" error (confirmed live twice now:
// the generalized sub-venue model's `sub_venue` column, 2026-09-06, and the
// admin-unpublish override's `admin_unpublish_reason`/`admin_unpublished_at`
// columns, same day) — additive migrations are safe, and necessary, to
// apply ahead of the corresponding code merge for exactly this reason. Even
// so, a PR's very first automatic build can still race a same-day migration
// dispatch that completes moments after that build already started against
// the old schema — if that happens, the fix is a fresh build once the
// migration has landed, not a code change here.
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

  const venueRoutes: MetadataRoute.Sitemap = venues.map((venue) => ({
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
