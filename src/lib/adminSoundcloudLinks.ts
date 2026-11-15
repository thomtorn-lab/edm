import { soundcloudProfileUrl } from "./adapters/cultureBoxSoundcloudLinks";

/**
 * Rules for admin-entered artist SoundCloud links (2026-11-15) — the manual
 * counterpart of venue-provided links, typed in per lineup artist when an
 * admin creates or edits an event by hand. Pure: the Postgres side is
 * src/db/eventSoundcloudAdmin.ts.
 *
 * A link must be a SoundCloud profile (one path segment, not one of
 * SoundCloud's own pages) and is stored normalized as
 * https://soundcloud.com/<handle>. Unlike the venue-link filter, a handle
 * that reads as a label or a venue account is accepted: here the admin's
 * own choice is the evidence.
 */

export interface AdminSoundcloudLinkInput {
  artistName: string;
  url: string;
}

export type AdminSoundcloudPlan =
  | { ok: true; links: AdminSoundcloudLinkInput[] }
  | { ok: false; error: string };

/** Normalized profile URL, or a readable reason it can't be used. */
export function adminSoundcloudProfileUrl(input: string): { url: string } | { error: string } {
  const result = soundcloudProfileUrl(input);
  if ("url" in result) return result;
  switch (result.rejected) {
    case "label-or-organisation":
    case "venue-account": {
      // Accepted for admins — rebuild the normalized URL the filter would have returned.
      const handle = new URL(input.trim()).pathname.split("/").filter(Boolean)[0].toLowerCase();
      return { url: `https://soundcloud.com/${handle}` };
    }
    case "not-soundcloud":
      return { error: "isn't a soundcloud.com link (short on.soundcloud.com links can't be used — open it and copy the profile address)" };
    case "reserved-path":
      return { error: "is a SoundCloud page, not an artist profile" };
    default:
      return { error: "isn't an artist profile — use the profile link (soundcloud.com/<name>), not a track or set" };
  }
}

/**
 * Validates the full set of links an admin saved for one event. Every name
 * must be in the event's current lineup (exact name); empty URLs are
 * dropped (that clears the artist's link); a name may appear only once.
 * Returns the complete new set — saving replaces whatever was stored.
 */
export function planAdminSoundcloudLinks(lineup: string[], input: unknown): AdminSoundcloudPlan {
  if (!Array.isArray(input)) return { ok: false, error: "Body must be { links: [{ artistName, url }] }." };
  const lineupSet = new Set(lineup);
  const seen = new Set<string>();
  const links: AdminSoundcloudLinkInput[] = [];
  for (const entry of input) {
    const artistName = typeof entry?.artistName === "string" ? entry.artistName : null;
    const rawUrl = typeof entry?.url === "string" ? entry.url.trim() : null;
    if (artistName === null || rawUrl === null) return { ok: false, error: "Every link needs an artistName and a url." };
    if (!lineupSet.has(artistName)) {
      return { ok: false, error: `"${artistName}" isn't in this event's lineup — save the lineup first, then add the link.` };
    }
    if (seen.has(artistName)) return { ok: false, error: `"${artistName}" has more than one link.` };
    seen.add(artistName);
    if (!rawUrl) continue;
    const parsed = adminSoundcloudProfileUrl(rawUrl);
    if ("error" in parsed) return { ok: false, error: `The link for ${artistName} ${parsed.error} — nothing was saved.` };
    links.push({ artistName, url: parsed.url });
  }
  return { ok: true, links };
}
