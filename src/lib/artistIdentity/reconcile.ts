import { cleanArtistDisplayName } from "../enrichment/genreEnrichment";
import { classifyAppearance, splitLineupEntry, type AppearanceBucket } from "./lineupIdentity";

/**
 * State-based reconciliation of lineup appearances (Artist Alerts, G1 rules
 * approved 2026-11-02). Pure: given what is stored, returns what to write.
 * src/db/artistAppearances.ts runs it after every sync and on a schedule;
 * because it compares against stored state, any run catches up everything
 * a missed run would have done.
 *
 * Confidence rules (G1):
 * - not a performer (shared non-artist classification, venue names) -> excluded;
 * - the source's own SoundCloud link for this name on this event -> high,
 *   unless it contradicts the profile already known for that artist;
 * - a distinctive name with exactly one matching artist -> high;
 * - an event title stored as the artist, or a short/generic name -> high only
 *   when the artist's identity is already documented elsewhere (verified, or
 *   backed by a source profile link), otherwise review;
 * - event words, label shapes, possible multi-act entries -> review;
 * - several artists sharing the name, conflicting profiles, or a requested
 *   artist matched by name only -> review.
 * Discogs ambiguity is not used: it never blocks an identity documented
 * by another source, and on its own it decides nothing.
 * An admin's confirm/reject on an appearance is never overwritten.
 */

export type Confidence = "high" | "confirmed" | "review" | "excluded" | "rejected";

export interface ReconcileEvent {
  id: string;
  title: string;
  artists: string[];
}

export interface ReconcileArtist {
  id: string;
  displayName: string;
  nameKey: string;
  status: "auto" | "verified" | "requested" | "rejected";
  profileUrl: string | null;
  mergedIntoId: string | null;
}

export interface ReconcileAppearance {
  eventId: string;
  nameKey: string;
  artistId: string | null;
  lineupEntry: string;
  displayName: string;
  confidence: Confidence;
  reason: string | null;
  visibleSince: Date | null;
  confirmedAt: Date | null;
  removedAt: Date | null;
}

export interface ReconcileInput {
  /** Publicly listed, upcoming events only. */
  events: ReconcileEvent[];
  artists: ReconcileArtist[];
  /** Every stored appearance (all events), used for continuity of verified identities. */
  appearances: ReconcileAppearance[];
  /** Non-blocked source SoundCloud links: (eventId, artistName as linked, profile URL). */
  soundcloudLinks: { eventId: string; artistName: string; url: string }[];
  venueKeys: ReadonlySet<string>;
  now: Date;
  newArtistId: () => string;
}

export interface ReconcileResult {
  newArtists: ReconcileArtist[];
  /** Artists whose status changes (requested -> verified on a matching source profile). */
  verifiedArtistIds: string[];
  upserts: ReconcileAppearance[];
}

const ALERTABLE: ReadonlySet<Confidence> = new Set(["high", "confirmed"]);

export function isAlertableConfidence(c: string): boolean {
  return ALERTABLE.has(c as Confidence);
}

/** Lower-cased https://soundcloud.com/<handle> for comparing a requester's link with a source link. */
export function normalizeSoundcloudUrl(url: string | null): string | null {
  if (!url) return null;
  const m = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i.exec(url.trim());
  return m ? `https://soundcloud.com/${m[1].toLowerCase()}` : null;
}

export function reconcileAppearances(input: ReconcileInput): ReconcileResult {
  const { now } = input;
  const artists = [...input.artists];
  const newArtists: ReconcileArtist[] = [];
  const verifiedArtistIds: string[] = [];
  const existing = new Map(input.appearances.map((a) => [`${a.eventId}|${a.nameKey}`, a]));

  // Profile links per event, by linked name and by key.
  const linksByEvent = new Map<string, Map<string, string>>();
  for (const l of input.soundcloudLinks) {
    const url = normalizeSoundcloudUrl(l.url) ?? l.url;
    if (!linksByEvent.has(l.eventId)) linksByEvent.set(l.eventId, new Map());
    linksByEvent.get(l.eventId)!.set(l.artistName, url);
  }

  // Profiles already documented for each artist (from its stored source-backed appearances).
  const knownProfiles = new Map<string, Set<string>>();
  const documented = new Set<string>();
  const addProfile = (artistId: string, url: string) => {
    if (!knownProfiles.has(artistId)) knownProfiles.set(artistId, new Set());
    knownProfiles.get(artistId)!.add(url);
  };
  for (const a of input.appearances) {
    if (!a.artistId) continue;
    if (a.confidence === "confirmed") documented.add(a.artistId);
    const url = linksByEvent.get(a.eventId)?.get(a.displayName) ?? linksByEvent.get(a.eventId)?.get(a.lineupEntry);
    if (url && a.confidence !== "rejected" && a.confidence !== "review") {
      addProfile(a.artistId, url);
      documented.add(a.artistId);
    }
  }
  for (const art of artists) if (art.status === "verified") documented.add(art.id);

  const candidatesFor = (key: string) => artists.filter((a) => a.nameKey === key && a.mergedIntoId === null && a.status !== "rejected");

  const upserts: ReconcileAppearance[] = [];
  for (const ev of input.events) {
    const handles = linksByEvent.get(ev.id);
    const seen = new Set<string>();
    for (const entry of ev.artists) {
      for (const part of splitLineupEntry(entry)) {
        const handle = handles?.get(part.name) ?? handles?.get(entry) ?? null;
        const c = classifyAppearance({
          entry,
          part,
          eventTitle: ev.title,
          lineupSize: ev.artists.length,
          hasSourceHandle: handle !== null,
          venueKeys: input.venueKeys,
        });
        if (!c.key || seen.has(c.key)) continue;
        seen.add(c.key);
        const prior = existing.get(`${ev.id}|${c.key}`);
        const displayName = cleanArtistDisplayName(part.name);

        let artistId: string | null = prior?.artistId ?? null;
        let confidence: Confidence;
        let reason: string | null;

        if (prior && (prior.confidence === "confirmed" || prior.confidence === "rejected")) {
          // Admin decisions are sticky.
          confidence = prior.confidence;
          reason = prior.reason;
        } else if (c.confidence === "excluded") {
          artistId = null;
          confidence = "excluded";
          reason = c.bucket;
        } else {
          const decided = decide(c.bucket, c.key, displayName, handle);
          artistId = decided.artistId;
          confidence = decided.confidence;
          reason = decided.reason;
        }

        const becameAlertable = isAlertableConfidence(confidence);
        upserts.push({
          eventId: ev.id,
          nameKey: c.key,
          artistId,
          lineupEntry: entry,
          displayName,
          confidence,
          reason,
          visibleSince: prior?.visibleSince ?? now,
          confirmedAt: prior?.confirmedAt ?? (becameAlertable ? now : null),
          removedAt: null,
        });
      }
    }
    // Lineup entries that disappeared: mark removed, never delete (a return is not "new").
    for (const a of input.appearances) {
      if (a.eventId === ev.id && !seen.has(a.nameKey) && a.removedAt === null) upserts.push({ ...a, removedAt: now });
    }
  }
  return { newArtists, verifiedArtistIds, upserts };

  function decide(bucket: AppearanceBucket, key: string, displayName: string, handle: string | null): { artistId: string | null; confidence: Confidence; reason: string } {
    const candidates = candidatesFor(key);
    if (candidates.length > 1) return { artistId: null, confidence: "review", reason: "several artists share this name" };

    let artist = candidates[0];
    if (!artist) {
      artist = { id: input.newArtistId(), displayName, nameKey: key, status: "auto", profileUrl: null, mergedIntoId: null };
      artists.push(artist);
      newArtists.push(artist);
    }

    const profiles = knownProfiles.get(artist.id);
    if (profiles && profiles.size > 1) return { artistId: artist.id, confidence: "review", reason: "artist has conflicting profile links" };

    if (artist.status === "requested") {
      const requested = normalizeSoundcloudUrl(artist.profileUrl);
      if (handle && requested && handle === requested) {
        artist.status = "verified";
        verifiedArtistIds.push(artist.id);
        documented.add(artist.id);
        addProfile(artist.id, handle);
        return { artistId: artist.id, confidence: "high", reason: "source profile matches the requested profile" };
      }
      return { artistId: artist.id, confidence: "review", reason: "requested artist matched by name only" };
    }

    if (handle) {
      if (profiles && profiles.size === 1 && !profiles.has(handle)) {
        return { artistId: artist.id, confidence: "review", reason: "source profile differs from the artist's known profile" };
      }
      addProfile(artist.id, handle);
      documented.add(artist.id);
      return { artistId: artist.id, confidence: "high", reason: "source profile link" };
    }

    switch (bucket) {
      case "distinct":
        return { artistId: artist.id, confidence: "high", reason: "distinctive name" };
      case "short_generic":
      case "title_copy":
        return documented.has(artist.id)
          ? { artistId: artist.id, confidence: "high", reason: `${bucket}: identity documented elsewhere` }
          : { artistId: artist.id, confidence: "review", reason: `${bucket}: identity not documented` };
      default:
        return { artistId: artist.id, confidence: "review", reason: bucket };
    }
  }
}
