/**
 * The site's one canonical origin. Production serves from the www host —
 * electroniccph.com (no www) permanently redirects there at the Vercel
 * domain level — so every absolute URL the app emits (metadataBase and
 * therefore canonical/og URLs, sitemap, robots.txt, JSON-LD, calendar
 * exports, newsletter links) uses this origin and never points at a URL
 * that would immediately redirect.
 */
export const SITE_URL = "https://www.electroniccph.com";
