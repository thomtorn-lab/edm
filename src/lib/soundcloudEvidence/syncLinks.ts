import type { RawCandidateEvent, SoundcloudLinkReport, ArtistSoundcloudLink } from "../adapters/types";
import { extractSourceSoundcloudEvidence, findKeyConflicts, type SoundcloudEvidence } from "./sourceEvidence";

/**
 * Source-provided SoundCloud links for the sync (2026-11-03): what
 * src/db/sync.ts stores in event_soundcloud_links, the table the site
 * already shows "Listen on SoundCloud" from. Pure.
 *
 * - A source that already reports structured links (Culture Box's
 *   soundcloudLinkReport) is passed through untouched, so its behaviour,
 *   including documented-absence deletes, is exactly as before.
 * - Every other source contributes only links its own text gives for this
 *   event ("Name: soundcloud.com/x", Hangaren/Pylonen/KultuNaut), and only
 *   when the evidence would back the appearance on its own: a source_*
 *   signal, no conflict, and the profile belongs to a whole lineup entry
 *   (never one side of a B2B, never a duo/collective/label). These reports
 *   never document absence, so they never delete a stored link.
 * - Names guessed from the title, and admin-created events (no source
 *   sync), never get links here.
 */

export interface InlineObservation {
  eventId: string;
  records: SoundcloudEvidence[];
}

/** Inline evidence for one synced event, against the lineup that event will have after this sync. */
export function inlineSoundcloudEvidenceForSync(
  raw: Pick<RawCandidateEvent, "sourceId" | "sourceUrl" | "description" | "relevanceText" | "lineupSourceText" | "soundcloudLinkReport" | "artistsGuessedFromTitle">,
  lineup: readonly string[],
  eventId: string,
  extraTexts: readonly (string | null)[] = [],
  observedAt: Date = new Date(),
): SoundcloudEvidence[] {
  if (raw.soundcloudLinkReport || raw.artistsGuessedFromTitle || lineup.length === 0) return [];
  return extractSourceSoundcloudEvidence({
    artists: lineup,
    texts: [raw.lineupSourceText, raw.description, raw.relevanceText, ...extraTexts],
    sourceId: raw.sourceId,
    eventId,
    sourceUrl: raw.sourceUrl,
    observedAt,
  });
}

/**
 * One sync run's inline observations -> reports to store. Run-wide key
 * conflicts are applied first (one name with two profiles across this run's
 * events: nothing is stored for it), then only clean, whole-entry links
 * remain. Events with no remaining link get no report at all.
 */
export function inlineReportsForSync(observations: readonly InlineObservation[]): Map<string, SoundcloudLinkReport> {
  const checked = findKeyConflicts(observations.flatMap((o) => o.records));
  const out = new Map<string, SoundcloudLinkReport>();
  for (const r of checked) {
    if (r.conflict || r.eventId === null || r.entry !== r.part) continue;
    if (r.signal !== "source_inline" && r.signal !== "source_anchor") continue;
    const report = out.get(r.eventId) ?? { links: [] as ArtistSoundcloudLink[], absenceDocumented: false };
    if (!report.links.some((l) => l.name === r.entry)) report.links.push({ name: r.entry, url: r.url });
    out.set(r.eventId, report);
  }
  return out;
}
