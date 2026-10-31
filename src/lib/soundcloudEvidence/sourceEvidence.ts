import { artistIdentityKey, hasEventMarker, hasWeakSeparator, splitLineupEntry } from "../artistIdentity/lineupIdentity";
import { cleanArtistDisplayName, isShortGenericArtistName } from "../enrichment/genreEnrichment";
import { decodeHtmlEntities } from "../adapters/htmlExtraction";
import { soundcloudProfileUrl } from "../adapters/cultureBoxSoundcloudLinks";
import type { RawCandidateEvent } from "../adapters/types";
import type { EvidenceSignal, IdentityEvidence } from "../artistIdentity/evidence";

/**
 * Source-provided SoundCloud evidence (2026-10-24), the SoundCloud side of
 * the shared artist identity model that Artist Alerts owns
 * (src/lib/artistIdentity/). Pure functions: no database, no network, no
 * SoundCloud lookup. Turns what a source itself says about one event (its
 * lineup plus its own links) into evidence records keyed by
 * artistIdentityKey. Never a separate identity: the shared model decides
 * which artist a record belongs to.
 *
 * Two signals, both from the source's own page for this event:
 *   - "source_anchor": a lineup name the source marks up as a link to a
 *     profile (Culture Box's lineup anchors, via the adapter's
 *     soundcloudLinkReport).
 *   - "source_inline": a lineup name followed in the source's own text by
 *     a profile URL ("Kromagon: https://soundcloud.com/aragon",
 *     "mirr (Zeitgeist) https://soundcloud.com/mirulstrup"). Found in any
 *     source's description or lineup text, so no adapter needs SoundCloud
 *     logic of its own.
 *
 * A record is only ever attached to ONE lineup entry, and only when the
 * label in front of the URL is that entry (same identity key). Anything
 * else is reported as a conflict, so the shared model sends it to review
 * instead of linking:
 *   - entry_not_single_artist: the entry is a duo/collective/label shape
 *     ("Lulla-Li & Nihility", "… Records"), so the profile can't be
 *     credited to one artist;
 *   - two_handles_same_event: the source gives one artist two profiles;
 *   - two_handles_same_key: across events, one identity key carries two
 *     different profiles (Culture Box "LELE" and "LeLe"), so the name alone
 *     can never pick one. See findKeyConflicts.
 */

/**
 * The shared contract (Artist Alerts owns it): every record this module
 * produces is an IdentityEvidence of kind "soundcloud_profile" with one of
 * the two source_* signals. No SoundCloud-specific record type exists.
 */
export type SoundcloudEvidence = IdentityEvidence;

/** The handle part of a normalized profile URL (derived, never stored separately). */
export function handleOf(url: string): string {
  return url.slice("https://soundcloud.com/".length);
}

export interface EvidenceInput {
  /** The event's lineup entries, as stored. */
  artists: readonly string[];
  /** The source's own text for this event: description, lineup text, … HTML or plain. */
  texts: readonly (string | null | undefined)[];
  /** Structured name -> profile links the adapter already parsed (Culture Box anchors). */
  anchoredLinks?: readonly { name: string; url: string }[];
  sourceId: string;
  eventId: string | null;
  sourceUrl: string | null;
  observedAt: Date;
}

const URL_RE = /https?:\/\/[^\s<>"'()]+/giu;

/** HTML to text, keeping each link's target next to its text so "Name: <a href=URL>…</a>" reads "Name: … URL". */
function textWithLinkTargets(source: string): string {
  return decodeHtmlEntities(
    source
      .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/giu, (_m, href: string, inner: string) => {
        const text = inner.replace(/<[^>]+>/g, " ").trim();
        return text === href || /^https?:\/\//iu.test(text) ? ` ${href} ` : ` ${text} ${href} `;
      })
      .replace(/<br\s*\/?>|<\/(?:p|div|li|h\d)>/giu, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\u200B-\u200D\uFEFF]/gu, "")
    .replace(/[ \t]+/gu, " ");
}

/**
 * The ways the text in front of a URL can name an artist, most specific
 * first: the whole label, then the label cut before an affiliation
 * ("SEID (Frikvens Syndikatet)", "Fagins Reject – Wild Things Records",
 * "Kromagon - NOISEKULT + Zenon Records").
 */
function labelVariants(rawLabel: string): string[] {
  const label = rawLabel.replace(/^[\s:;,.\-–—|]+|[\s:;,\-–—|]+$/gu, "").trim();
  if (!label) return [];
  const variants = new Set<string>([label]);
  for (const cut of [/\s*\(/u, /\s+[–—-]\s+/u, /\s*:\s*/u]) {
    const head = label.split(cut)[0]?.trim();
    if (head) variants.add(head);
  }
  return [...variants];
}

interface Target {
  entry: string;
  part: string;
}

/** Lineup entries (or one B2B side of an entry) whose identity key equals `key`. */
function targetsForKey(artists: readonly string[], key: string): Target[] {
  if (!key) return [];
  const out: Target[] = [];
  for (const entry of artists) {
    if (artistIdentityKey(entry) === key) out.push({ entry, part: entry });
    else {
      const side = splitLineupEntry(entry).find((p) => p.fromB2bSplit && artistIdentityKey(p.name) === key);
      if (side) out.push({ entry, part: side.name });
    }
  }
  return out;
}

const targetId = (t: Target) => `${t.entry}\u0000${t.part}`;

/** A duo/collective/label shape: a profile in front of it can't be credited to one artist. */
export function isSingleArtistEntry(entry: string): boolean {
  const cleaned = cleanArtistDisplayName(entry);
  return !hasWeakSeparator(cleaned) && !hasEventMarker(cleaned);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * A lineup entry that ENDS the label, when what precedes it is a boundary:
 * line start, sentence punctuation, or another lineup entry
 * ("… the house. Xulipa mirr (Zeitgeist) URL" -> mirr). A name in the middle
 * of prose ("… played by Benwal during Awakenings URL") is not preceded by
 * any of these and never matches.
 */
function trailingEntryMatches(labelText: string, artists: readonly string[]): string[] {
  const label = labelText.replace(/\s*\([^)]*\)\s*$/u, "").replace(/[\s:;,\-–—|]+$/u, "").trim();
  const out: string[] = [];
  for (const entry of artists) {
    const name = entry.trim();
    if (!name) continue;
    const m = label.match(new RegExp(`(^|[\\s.!?:;])${escapeRe(name)}$`, "iu"));
    if (!m) continue;
    const before = label.slice(0, label.length - name.length).trimEnd();
    const boundary =
      before === "" || /[.!?:;]$/u.test(before) || artists.some((other) => other !== entry && before.toLowerCase().endsWith(other.trim().toLowerCase()));
    if (boundary) out.push(entry);
  }
  return out;
}

interface Pairing extends Target {
  url: string;
}

/**
 * "Label URL" pairs from one text. The label is the text since the previous
 * URL (any URL: a Mixcloud link after "SEID … soundcloud.com/seid1312"
 * still ends SEID's label), or since the line start. A URL right after
 * another, with no text between, belongs to the same label
 * ("Lulla-Li & Nihility: URL1 URL2").
 */
function inlinePairings(text: string, artists: readonly string[]): Pairing[] {
  const pairs: Pairing[] = [];
  for (const line of textWithLinkTargets(text).split("\n")) {
    let cursor = 0;
    let lastTarget: Target | null = null;
    for (const m of line.matchAll(URL_RE)) {
      const between = line.slice(cursor, m.index);
      cursor = (m.index ?? 0) + m[0].length;
      const href = m[0].replace(/[.,;:!?]+$/u, "");
      const profile = soundcloudProfileUrl(href);
      const labelText = between.trim();
      let target: Target | null = null;
      if (/^[\s:;,\-–—|]*$/u.test(labelText)) {
        target = lastTarget; // URL directly after URL: same label
      } else {
        const matches = new Map<string, Target>();
        for (const variant of labelVariants(labelText)) {
          for (const t of targetsForKey(artists, artistIdentityKey(variant))) matches.set(targetId(t), t);
          if (matches.size > 0) break; // most specific variant that matches wins
        }
        if (matches.size === 0) for (const e of trailingEntryMatches(labelText, artists)) matches.set(targetId({ entry: e, part: e }), { entry: e, part: e });
        // Two lineup positions answer to this label ("DJ Void" alone and in "Ingvil B2B DJ Void"): ambiguous, not paired.
        target = matches.size === 1 ? [...matches.values()][0] : null;
      }
      lastTarget = target;
      if (target && "url" in profile) pairs.push({ ...target, url: profile.url });
    }
  }
  return pairs;
}

/** All SoundCloud evidence one event's own source data gives, with per-event conflicts flagged. */
export function extractSourceSoundcloudEvidence(input: EvidenceInput): SoundcloudEvidence[] {
  const raw: (Pairing & { signal: EvidenceSignal })[] = [];
  for (const link of input.anchoredLinks ?? []) {
    const profile = soundcloudProfileUrl(link.url);
    const exact = input.artists.find((a) => a === link.name);
    const targets = exact ? [{ entry: exact, part: exact }] : targetsForKey(input.artists, artistIdentityKey(link.name));
    if (targets.length === 1 && "url" in profile) raw.push({ ...targets[0], url: profile.url, signal: "source_anchor" });
  }
  for (const text of input.texts) {
    if (!text) continue;
    for (const p of inlinePairings(text, input.artists)) raw.push({ ...p, signal: "source_inline" });
  }

  // One record per (performer, url); an anchor outranks the same pair found inline.
  const byPair = new Map<string, (typeof raw)[number]>();
  for (const r of raw) {
    const id = `${targetId(r)}\u0000${r.url}`;
    if (!byPair.has(id) || r.signal === "source_anchor") byPair.set(id, r);
  }
  const urlsByTarget = new Map<string, Set<string>>();
  for (const r of byPair.values()) {
    if (!urlsByTarget.has(targetId(r))) urlsByTarget.set(targetId(r), new Set());
    urlsByTarget.get(targetId(r))!.add(r.url);
  }

  return [...byPair.values()].map((r) => {
    const urls = urlsByTarget.get(targetId(r))!;
    let conflict: SoundcloudEvidence["conflict"] = null;
    if (!isSingleArtistEntry(r.part)) conflict = { kind: "entry_not_single_artist", otherUrls: [...urls].filter((u) => u !== r.url) };
    else if (urls.size > 1) conflict = { kind: "two_handles_same_event", otherUrls: [...urls].filter((u) => u !== r.url) };
    return {
      kind: "soundcloud_profile" as const,
      entry: r.entry,
      part: r.part,
      key: artistIdentityKey(r.part),
      url: r.url,
      signal: r.signal,
      sourceId: input.sourceId,
      eventId: input.eventId,
      sourceUrl: input.sourceUrl,
      observedAt: input.observedAt,
      conflict,
    };
  });
}

/**
 * Cross-event check over every record: an identity key that carries more
 * than one profile is marked two_handles_same_key on every record with that
 * key (Culture Box "LELE" -> user-442274348, "LeLe" -> user-339333395). Per
 * the shared contract, conflicted evidence is never used to link, so every
 * appearance under that key goes to review, including each event's own
 * source link, until an admin splits the identities. (The existing
 * event-based display, event_soundcloud_links, is separate and unchanged.)
 */
export function findKeyConflicts(records: readonly SoundcloudEvidence[]): SoundcloudEvidence[] {
  const urlsByKey = new Map<string, Set<string>>();
  for (const r of records) {
    if (!urlsByKey.has(r.key)) urlsByKey.set(r.key, new Set());
    urlsByKey.get(r.key)!.add(r.url);
  }
  return records.map((r) => {
    const urls = urlsByKey.get(r.key)!;
    if (urls.size <= 1 || r.conflict) return r;
    return { ...r, conflict: { kind: "two_handles_same_key", otherUrls: [...urls].filter((u) => u !== r.url) } };
  });
}

/**
 * CANDIDATES only (the shared model decides; reuse across events is its
 * rule, applied with the accepted evidence it holds). Profiles a source link
 * would let other events reuse by name: keys
 * with exactly one profile across all records, no conflict anywhere, and a
 * distinctive name (not short/generic, not a duo/collective shape). Short
 * names keep their per-event source evidence but are never reused by name,
 * per the approved identity rules: reuse elsewhere goes to review.
 */
export function reusableProfilesByKey(records: readonly SoundcloudEvidence[]): Map<string, string> {
  const checked = findKeyConflicts(records);
  const conflicted = new Set(checked.filter((r) => r.conflict).map((r) => r.key));
  const out = new Map<string, string>();
  for (const r of checked) {
    if (conflicted.has(r.key) || !r.key) continue;
    const cleaned = cleanArtistDisplayName(r.part);
    if (isShortGenericArtistName(cleaned) || !isSingleArtistEntry(r.part)) continue;
    out.set(r.key, r.url);
  }
  return out;
}

/** Evidence for one sync candidate: the adapter's structured links plus every text the source gave for it. */
export function evidenceForCandidate(
  raw: Pick<
    RawCandidateEvent,
    "sourceId" | "sourceUrl" | "artists" | "description" | "relevanceText" | "lineupSourceText" | "soundcloudLinkReport" | "artistsGuessedFromTitle"
  >,
  options: { eventId: string | null; observedAt: Date },
): SoundcloudEvidence[] {
  // Names guessed from the title are not the source's lineup: a profile link
  // in its text can't be credited to one of them.
  if (raw.artistsGuessedFromTitle) return [];
  return extractSourceSoundcloudEvidence({
    artists: raw.artists,
    texts: [raw.lineupSourceText, raw.description, raw.relevanceText],
    anchoredLinks: raw.soundcloudLinkReport?.links ?? [],
    sourceId: raw.sourceId,
    eventId: options.eventId,
    sourceUrl: raw.sourceUrl,
    observedAt: options.observedAt,
  });
}

/**
 * Evidence for an event already stored: its current lineup and stored
 * description (Pylonen keeps the source's profile links there). Only names
 * still in the event's current lineup can get a record, so an admin-edited
 * lineup is respected as it is. An event without a canonical source
 * (admin-created) yields nothing until the shared model defines how such
 * evidence is attributed (IdentityEvidence.sourceId is required).
 */
export function evidenceForStoredEvent(
  row: {
    id: string;
    canonicalSourceId: string | null;
    artists: readonly string[];
    description: string | null;
    officialEventUrl: string | null;
  },
  observedAt: Date,
): SoundcloudEvidence[] {
  if (!row.canonicalSourceId) return [];
  return extractSourceSoundcloudEvidence({
    artists: row.artists,
    texts: [row.description],
    sourceId: row.canonicalSourceId,
    eventId: row.id,
    sourceUrl: row.officialEventUrl,
    observedAt,
  });
}
