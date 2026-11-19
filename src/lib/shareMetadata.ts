/**
 * Shared link-preview metadata (Open Graph + Twitter card) for every public
 * page — what Messenger, Facebook, WhatsApp, LinkedIn, iMessage, X, Slack,
 * Discord etc. read when an ElectronicCPH link is shared (2026-11-19).
 *
 * One function, one shape, no platform-specific tags: every page passes its
 * own share title/description/path and, where it has one, an image; pages
 * without a suitable image get the single static branded fallback
 * (public/og/default.png, 1200×630, approved 2026-11-19). No runtime image
 * generation, fetching or processing.
 *
 * Next.js merges metadata shallowly — a page-level `openGraph` replaces the
 * layout's whole object — so this always returns the complete set rather
 * than relying on inheritance.
 */
import type { Metadata } from "next";

export const SITE_NAME = "Electronic CPH";
export const SITE_DEFAULT_TITLE = "Electronic CPH — Copenhagen Electronic Music Events";
export const SITE_DEFAULT_DESCRIPTION =
  "Techno, house, trance, drum & bass and more — a fast, curated index of electronic music events in Copenhagen.";
const OG_LOCALE = "en_GB";

export type ShareImage = {
  url: string;
  alt: string;
  /** Only ever set when the image's real pixel size is known. */
  width?: number;
  height?: number;
  type?: string;
};

/** The approved static branded fallback (public/og/default.png). */
export const FALLBACK_SHARE_IMAGE: ShareImage = {
  url: "/og/default.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Electronic CPH — electronic music events in Copenhagen",
};

/** "Venues" -> "Venues — Electronic CPH" (the same form the layout's title template renders). */
export function shareTitle(label: string): string {
  return `${label} — ${SITE_NAME}`;
}

/**
 * Smallest image the major platforms accept for a preview (Facebook's
 * documented minimum is 200×200); a known-smaller image gets the fallback.
 */
const MIN_SHARE_IMAGE_PX = 200;

/**
 * KultuNaut serves each event image as resized copies whose size is part of
 * the file name (".../W154H154_<file>", ".../W484H252_<file>"). Every
 * captured KultuNaut detail page (src/lib/adapters/__fixtures__) offers both
 * sizes for the same <file>, so a stored 154×154 thumbnail — what the
 * adapter picked before 2026-11-19 — maps to the 484×252 copy without a data
 * migration.
 */
const KULTUNAUT_SIZED_IMAGE = /^(https:\/\/www\.kultunaut\.dk\/perl\/images\/[^/]+\/)W(\d+)H(\d+)_([^/]+)$/;

/**
 * The event's own image when it can serve as a social preview, otherwise the
 * fallback. Only https URLs are used — an http URL is never rewritten to
 * https (that is only safe where the host is known to serve it) and falls
 * back instead. WebP and large files are accepted as-is.
 */
export function shareImageForEvent(imageUrl: string | null | undefined, alt: string): ShareImage {
  const raw = imageUrl?.trim();
  if (!raw) return FALLBACK_SHARE_IMAGE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return FALLBACK_SHARE_IMAGE;
  }
  if (url.protocol !== "https:") return FALLBACK_SHARE_IMAGE;

  const kultunaut = raw.match(KULTUNAUT_SIZED_IMAGE);
  if (kultunaut) {
    const [, base, w, h, file] = kultunaut;
    if (w === "154" && h === "154") return { url: `${base}W484H252_${file}`, width: 484, height: 252, alt };
    const width = Number(w);
    const height = Number(h);
    if (width < MIN_SHARE_IMAGE_PX || height < MIN_SHARE_IMAGE_PX) return FALLBACK_SHARE_IMAGE;
    return { url: raw, width, height, alt };
  }
  return { url: raw, alt };
}

/**
 * The complete Open Graph + Twitter card block for one page. `path` is the
 * page's canonical path (resolved against metadataBase, like
 * `alternates.canonical`). Title, description and path are omitted only for
 * the root layout's site-wide default: it cannot know the requested URL, and
 * without a share title/description Next.js fills them from the page's own
 * <title>/meta description.
 */
export function buildShareMetadata(input: {
  title?: string;
  description?: string;
  path?: string;
  image?: ShareImage | null;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const image = input.image ?? FALLBACK_SHARE_IMAGE;
  return {
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OG_LOCALE,
      ...(input.path ? { url: input.path } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      images: [{ url: image.url, alt: image.alt }],
    },
  };
}

/** Lineup names beyond this are summarised as "and N more" to keep the preview short. */
const SHARE_DESCRIPTION_MAX_ARTISTS = 4;

/**
 * The event's share description, built only from the event's own data:
 * "Title: A, B — Techno · House at Venue, City, on Friday 20 November 2026."
 * Each part is left out cleanly when it is missing (no genre, no lineup, or
 * the title already names the lineup) — never a dangling "— at".
 */
export function buildEventShareDescription(input: {
  title: string;
  artists: string[];
  showArtists: boolean;
  genres: string[];
  venueName: string;
  city: string;
  dateLabel: string;
}): string {
  let text = input.title.trim();
  const artists = input.showArtists ? input.artists.map((a) => a.trim()).filter(Boolean) : [];
  if (artists.length) {
    const shown = artists.slice(0, SHARE_DESCRIPTION_MAX_ARTISTS).join(", ");
    const more = artists.length - SHARE_DESCRIPTION_MAX_ARTISTS;
    text += `: ${shown}${more > 0 ? ` and ${more} more` : ""}`;
  }
  const genres = input.genres.map((g) => g.trim()).filter(Boolean);
  if (genres.length) text += ` — ${genres.join(" · ")}`;
  const place = [input.venueName.trim(), input.city.trim()].filter(Boolean).join(", ");
  if (place) text += ` at ${place}`;
  text += `${place ? "," : ""} on ${input.dateLabel}.`;
  return text;
}
