import type { ArtistSoundcloudLink } from "./adapters/types";
import { dedupeArtistList } from "./normalize";

/**
 * Pure logic for venue-provided artist SoundCloud links (2026-10-13): what a
 * sync writes, and what a page shows. The Postgres side lives in
 * src/db/soundcloudLinks.ts (writes) and src/lib/queries.ts (reads).
 */

export interface StoredSoundcloudLink {
  eventId: string;
  artistName: string;
  url: string;
}

export interface SoundcloudLinkPlan {
  /** New rows, and rows whose URL changed. */
  upserts: StoredSoundcloudLink[];
  /** Rows the source documented as gone: the night was parsed this run and no longer links that name. */
  deletes: { eventId: string; artistName: string }[];
  /** Deletes held back because this run observed no acceptable link at all (see planSoundcloudLinkChanges). */
  suppressedDeletes: number;
}

/**
 * The lineup name as the sync stores it in events.artists (the pipeline runs
 * every adapter name through dedupeArtistList), so a link row's artistName
 * compares exactly against the event's own lineup. Null when nothing is left.
 */
export function storedArtistName(name: string): string | null {
  return dedupeArtistList([name])[0] ?? null;
}

/**
 * Diffs one sync run's observations against the rows already stored for
 * this source. `observed` holds an entry only for events this run actually
 * matched/created from a parsed night; events the run didn't see (fetch or
 * parse failure for that night, past nights no longer listed) are never
 * touched.
 *
 * A stored row is deleted only when its night was observed and no longer
 * carries that name's link. If the whole run observed no acceptable link at
 * all, deletes are suppressed: a page-structure change or a broken parse
 * looks exactly like that, and the venue removing every link at once is far
 * less likely — so correct links are kept until a run that does see links
 * confirms they are gone.
 */
export function planSoundcloudLinkChanges(
  existing: StoredSoundcloudLink[],
  observed: Map<string, ArtistSoundcloudLink[]>,
): SoundcloudLinkPlan {
  const totalObserved = [...observed.values()].reduce((n, links) => n + links.length, 0);
  const allowDeletes = totalObserved > 0;

  const existingByEvent = new Map<string, Map<string, string>>();
  for (const row of existing) {
    if (!existingByEvent.has(row.eventId)) existingByEvent.set(row.eventId, new Map());
    existingByEvent.get(row.eventId)!.set(row.artistName, row.url);
  }

  const plan: SoundcloudLinkPlan = { upserts: [], deletes: [], suppressedDeletes: 0 };
  for (const [eventId, links] of observed) {
    const stored = existingByEvent.get(eventId) ?? new Map<string, string>();
    const seen = new Set<string>();
    for (const link of links) {
      const artistName = storedArtistName(link.name);
      if (!artistName || seen.has(artistName)) continue;
      seen.add(artistName);
      if (stored.get(artistName) !== link.url) plan.upserts.push({ eventId, artistName, url: link.url });
    }
    for (const artistName of stored.keys()) {
      if (seen.has(artistName)) continue;
      if (allowDeletes) plan.deletes.push({ eventId, artistName });
      else plan.suppressedDeletes++;
    }
  }
  return plan;
}

/**
 * The links a page shows for one event: only rows whose name is in the
 * event's own current lineup (exact match — an admin-edited or changed
 * lineup simply drops names it no longer has), in lineup order, once each.
 * Blocked URLs are already excluded by the query.
 */
export function selectLineupSoundcloudLinks(
  artists: string[],
  rows: { artistName: string; url: string }[],
): { name: string; url: string }[] {
  const urlByName = new Map(rows.map((r) => [r.artistName, r.url]));
  const out: { name: string; url: string }[] = [];
  for (const name of artists) {
    const url = urlByName.get(name);
    if (url && !out.some((l) => l.name === name)) out.push({ name, url });
  }
  return out;
}
