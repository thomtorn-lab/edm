import { artistIdentityKey, splitLineupEntry } from "../artistIdentity/lineupIdentity";
import { evidenceForStoredEvent, findKeyConflicts, reusableProfilesByKey, type SoundcloudEvidence } from "./sourceEvidence";
import { soundcloudProfileUrl } from "../adapters/cultureBoxSoundcloudLinks";

/**
 * SoundCloud section of the joint read-only artist identity audit
 * (2026-10-24). Pure: the caller (the shared audit, src/db/artistIdentityAudit.ts)
 * loads the rows inside its verified read-only transaction and passes them in.
 * Answers, per canonical source, how many lineup performers already show a
 * venue-provided SoundCloud link, how many more the source's own stored text
 * documents (not captured yet), how many a verified handle from another event
 * would cover by name, and where evidence conflicts.
 *
 * Bases follow the shared audit: "observed" counts stored rows; "estimated"
 * applies the reuse rule (reusableProfilesByKey) to stored rows. Hangaren's
 * lineup links are not in stored rows at all (its description is null), so
 * its inline figure is a floor until a sync passes lineupSourceText.
 */

export interface EvidenceAuditEvent {
  id: string;
  canonicalSourceId: string | null;
  artists: string[];
  description: string | null;
  officialEventUrl: string | null;
}

export interface EvidenceAuditLink {
  eventId: string;
  artistName: string;
  url: string;
}

export interface SourceEvidenceCoverage {
  sourceId: string;
  events: number;
  performers: number;
  /** observed: a stored, unblocked event_soundcloud_links row for this performer. */
  shownToday: number;
  /** observed: not shown today, but the source's stored text pairs this performer with one profile, no conflict. */
  documentedNotCaptured: number;
  /** estimated: neither of the above, but a verified handle for the same distinctive key exists on another event. */
  reusableByKey: number;
  /** observed: performers whose only evidence is flagged (duo/collective, two handles). */
  conflicted: number;
  none: number;
}

export interface SoundcloudEvidenceAuditSection {
  basis: { shownToday: "observed"; documentedNotCaptured: "observed"; reusableByKey: "estimated"; conflicted: "observed" };
  bySource: SourceEvidenceCoverage[];
  /** observed: identity keys with more than one profile across stored links and stored text. */
  keysWithSeveralProfiles: { key: string; urls: string[]; entries: string[] }[];
  /** observed: stored links whose profile is blocked (never shown). */
  blockedLinks: number;
}

export function buildSoundcloudEvidenceAuditSection(input: {
  events: readonly EvidenceAuditEvent[];
  links: readonly EvidenceAuditLink[];
  blockedUrls: readonly string[];
}): SoundcloudEvidenceAuditSection {
  const blocked = new Set(input.blockedUrls);
  const shown = new Set(input.links.filter((l) => !blocked.has(l.url)).map((l) => `${l.eventId}\u0000${l.artistName}`));
  const eventById = new Map(input.events.map((e) => [e.id, e]));

  // Stored links are verified source anchors (the sync only stores accepted venue links).
  const anchorRecords: SoundcloudEvidence[] = input.links
    .filter((l) => !blocked.has(l.url) && eventById.has(l.eventId))
    .flatMap((l) => {
      const profile = soundcloudProfileUrl(l.url);
      if (!("url" in profile)) return [];
      const e = eventById.get(l.eventId)!;
      return [
        {
          entry: l.artistName,
          part: l.artistName,
          key: artistIdentityKey(l.artistName),
          url: profile.url,
          handle: profile.url.slice("https://soundcloud.com/".length),
          signal: "source_anchor" as const,
          sourceId: e.canonicalSourceId,
          eventId: e.id,
          sourceUrl: e.officialEventUrl,
          conflict: null,
        },
      ];
    });
  const inlineRecords = input.events.flatMap((e) => evidenceForStoredEvent(e));
  const all = findKeyConflicts([...anchorRecords, ...inlineRecords]);
  const reuse = reusableProfilesByKey(all);

  const bySourceMap = new Map<string, SourceEvidenceCoverage>();
  for (const e of input.events) {
    const sourceId = e.canonicalSourceId ?? "(admin)";
    if (!bySourceMap.has(sourceId)) {
      bySourceMap.set(sourceId, { sourceId, events: 0, performers: 0, shownToday: 0, documentedNotCaptured: 0, reusableByKey: 0, conflicted: 0, none: 0 });
    }
    const c = bySourceMap.get(sourceId)!;
    c.events++;
    for (const entry of e.artists) {
      for (const part of splitLineupEntry(entry)) {
        c.performers++;
        const own = all.filter((r) => r.eventId === e.id && r.entry === entry && r.part === part.name);
        if (shown.has(`${e.id}\u0000${entry}`)) c.shownToday++;
        else if (own.some((r) => !r.conflict && r.signal === "source_inline")) c.documentedNotCaptured++;
        else if (reuse.has(artistIdentityKey(part.name))) c.reusableByKey++;
        else if (own.length > 0) c.conflicted++;
        else c.none++;
      }
    }
  }

  const byKey = new Map<string, { urls: Set<string>; entries: Set<string> }>();
  for (const r of all) {
    if (!byKey.has(r.key)) byKey.set(r.key, { urls: new Set(), entries: new Set() });
    byKey.get(r.key)!.urls.add(r.url);
    byKey.get(r.key)!.entries.add(r.part);
  }

  return {
    basis: { shownToday: "observed", documentedNotCaptured: "observed", reusableByKey: "estimated", conflicted: "observed" },
    bySource: [...bySourceMap.values()].sort((a, b) => b.performers - a.performers || a.sourceId.localeCompare(b.sourceId)),
    keysWithSeveralProfiles: [...byKey.entries()]
      .filter(([, v]) => v.urls.size > 1)
      .map(([key, v]) => ({ key, urls: [...v.urls].sort(), entries: [...v.entries].sort() }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    blockedLinks: input.links.filter((l) => blocked.has(l.url)).length,
  };
}
