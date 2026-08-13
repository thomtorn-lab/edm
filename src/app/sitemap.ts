import type { MetadataRoute } from "next";
import { getPublishedEventsWithVenue } from "@/lib/queries";
import { VENUES } from "@/lib/data/venues";
import { FESTIVALS } from "@/lib/data/festivals";

const SITE_URL = "https://cph-electronic.events";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/venues`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/festivals`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];

  const eventRoutes: MetadataRoute.Sitemap = getPublishedEventsWithVenue().map((event) => ({
    url: `${SITE_URL}/events/${event.slug}`,
    lastModified: new Date(event.updatedAt),
    changeFrequency: "daily",
    priority: 0.8,
  }));

  const venueRoutes: MetadataRoute.Sitemap = VENUES.map((venue) => ({
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
