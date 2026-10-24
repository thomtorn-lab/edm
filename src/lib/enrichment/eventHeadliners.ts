import { classifyArtistName } from "./artistNameClassification";
import { cleanArtistDisplayName, normalizeArtistName } from "./genreEnrichment";

/**
 * REPORT-ONLY headliner inference for one event (YouTube preview headliner
 * priority, owner decisions 2026-10-16/17). Nothing in production calls this:
 * src/db/youtubePreviewRiskReport.ts uses it to show, read-only, which
 * artist each upcoming event is really about and whether the video shown
 * today belongs to that artist.
 *
 * Evidence rules (owner decision 2026-10-16):
 * - STRONG (can make a headliner "documented"): the event title naming the
 *   artist, the venue's own description stating it ("headline",
 *   "hovednavn", "main act", "all night long" in the same sentence as the
 *   name), or a structured source field (Billetto's own `headliners`, only
 *   when Billetto is the sole source and lists at most 3 names).
 * - SUPPORTING only (never proof on its own): lineup order, the poster file
 *   name, and which artist the venue's prose mentions first.
 *
 * "supported_prioritized" (owner decision 2026-10-17): allowed only with
 * signals from at least TWO genuinely independent groups and no stronger
 * evidence pointing elsewhere. Signals from the same origin count once:
 * - order: lineup_first and main_room_first — the adapter builds the lineup
 *   and the description's room blocks from the same listing.
 * - asset: poster_filename — the venue's marketing material.
 * - prose: description_first_mention — the venue's own free text, with the
 *   adapter-generated room blocks ("Black Box\nA, B, C") removed first.
 * Venue prose written in lineup order is a known residual dependency
 * between "prose" and "order"; the report measures how often they agree.
 */

export type SignalType =
  | "title_names_artist"
  | "only_performer"
  | "description_headline_cue"
  | "structured_source_field"
  | "lineup_first"
  | "main_room_first"
  | "poster_filename"
  | "description_first_mention";

export type SignalGroup = "strong" | "order" | "asset" | "prose";

export const SIGNAL_GROUP: Record<SignalType, SignalGroup> = {
  title_names_artist: "strong",
  only_performer: "strong",
  description_headline_cue: "strong",
  structured_source_field: "strong",
  lineup_first: "order",
  main_room_first: "order",
  poster_filename: "asset",
  description_first_mention: "prose",
};

export interface HeadlinerSignal {
  type: SignalType;
  group: SignalGroup;
  /** The lineup entry exactly as stored in events.artists. */
  artist: string;
  /** A short piece of the evidence (sentence, title, file name), for review. */
  excerpt: string;
}

export type HeadlinerConfidence = "documented" | "supported_prioritized" | "supported_insufficient" | "none";

export type HeadlinerFlag =
  | "title_is_generated_lineup"
  | "title_is_lineup_entry"
  | "equal_headliners"
  | "conflicting_support"
  | "lineup_alphabetical"
  | "festival_like"
  | "multi_room"
  | "multi_source"
  | "b2b_split"
  | "billetto_headliners_unverified"
  | "structured_role_not_stored"
  | "excluded_not_artist";

export interface HeadlinerCandidate {
  artist: string;
  independentGroups: SignalGroup[];
  hasStrongSignal: boolean;
}

export interface HeadlinerResult {
  headliners: string[];
  confidence: HeadlinerConfidence;
  signals: HeadlinerSignal[];
  candidates: HeadlinerCandidate[];
  flags: HeadlinerFlag[];
  /** The artist the venue's prose mentions first (null when there is no prose) — used to measure prose/order dependency across events. */
  proseFirstMention: string | null;
}

export interface EventHeadlinerInput {
  title: string;
  description: string | null;
  artists: string[];
  imageUrl: string | null;
  canonicalSourceId: string | null;
  /** Distinct source ids from source_event_links. */
  sourceIds: string[];
}

const HEADLINE_CUE = /\bheadlin\w*|\bhovednavn\w*|\bmain act\b|\btop of the bill\b|\ball night long\b/iu;
const FESTIVAL_WORD = /\bfestival\b/iu;
const TITLE_DERIVED_LINEUP_SOURCES = new Set(["src-poolen", "src-pumpehuset", "src-kultunaut", "src-hangaren", "src-gravity", "src-alice"]);

/** Lowercase, accents removed, whitespace collapsed — so "Tène" matches "Tene" and "CØKIT" matches "Cøkit". */
export function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/giu, "o")
    .replace(/æ/giu, "ae")
    .replace(/ß/gu, "ss")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of `name` as a whole phrase in `text` (accent/case-insensitive), or -1. */
export function mentionIndex(text: string, name: string): number {
  const needle = fold(cleanArtistDisplayName(name));
  if (!needle) return -1;
  const match = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}(?=[^\\p{L}\\p{N}]|$)`, "u").exec(fold(text));
  return match ? match.index + match[1].length : -1;
}

function slug(value: string): string {
  return fold(value).replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
}

function posterFileName(imageUrl: string): string | null {
  try {
    const last = new URL(imageUrl).pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, "");
  } catch {
    return null;
  }
}

/**
 * Splits the stored description into the venue's own prose and the
 * adapter-generated room blocks ("Black Box\nA, B, C" / "Lineup TBA") that
 * cultureBoxAdapter appends — a room block is a two-line paragraph whose
 * second line is made up only of this event's own lineup names.
 */
export function splitDescription(description: string | null, artists: string[]): { prose: string; rooms: { room: string; artists: string[] }[] } {
  if (!description) return { prose: "", rooms: [] };
  const lineup = new Set(artists.map((a) => fold(a)));
  const proseParts: string[] = [];
  const rooms: { room: string; artists: string[] }[] = [];
  for (const paragraph of description.split(/\n\s*\n/)) {
    const lines = paragraph.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 2) {
      if (/^lineup tba$/i.test(lines[1])) {
        rooms.push({ room: lines[0], artists: [] });
        continue;
      }
      const names = lines[1].split(/\s*,\s*/).filter(Boolean);
      if (names.length > 0 && names.every((n) => lineup.has(fold(n)))) {
        rooms.push({ room: lines[0], artists: names });
        continue;
      }
    }
    proseParts.push(paragraph);
  }
  return { prose: proseParts.join("\n\n"), rooms };
}

/**
 * Who a headline cue in one sentence is about: the performer named closest
 * BEFORE the cue word ("Animal Trainer jets in to headline"), plus any
 * performers joined to that name by and/&/og/b2b/x/+/"," ("A and B headline");
 * when no performer is named before the cue, the closest one after it
 * ("Aftenens hovednavn er Kasper Bjørke"). Every other performer in the same
 * sentence ("…, with Opener Act warming up") is NOT credited.
 */
export function cueSubjects(sentence: string, performers: string[]): string[] {
  const folded = fold(sentence);
  const mentions = performers
    .map((artist) => {
      const start = mentionIndex(sentence, artist);
      return { artist, start, end: start + fold(cleanArtistDisplayName(artist)).length };
    })
    .filter((m) => m.start >= 0)
    .sort((a, b) => a.start - b.start);
  // A cue word inside a performer's own name ("Real Headliner") is not a cue.
  const cues = [...folded.matchAll(new RegExp(HEADLINE_CUE.source, "giu"))];
  const cue = cues.find((c) => !mentions.some((m) => c.index! >= m.start && c.index! < m.end));
  if (!cue || cue.index === undefined) return [];
  const before = mentions.filter((m) => m.end <= cue.index);
  if (before.length === 0) {
    const after = mentions.find((m) => m.start >= cue.index);
    return after ? [after.artist] : [];
  }
  const subjects = [before[before.length - 1]];
  for (let i = before.length - 2; i >= 0; i--) {
    const gap = folded.slice(before[i].end, subjects[0].start);
    if (!/^\s*(?:,|&|\+|and|og|b2b|x)\s*$/u.test(gap)) break;
    subjects.unshift(before[i]);
  }
  return subjects.map((m) => m.artist);
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function isAlphabetical(names: string[]): boolean {
  if (names.length < 4) return false;
  const folded = names.map(fold);
  return folded.every((n, i) => i === 0 || folded[i - 1].localeCompare(n) <= 0);
}

function excerpt(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function identifyHeadliners(input: EventHeadlinerInput): HeadlinerResult {
  const flags = new Set<HeadlinerFlag>();
  const signals: HeadlinerSignal[] = [];

  // Only real performers can be headliners: placeholders, event titles and
  // other non-artist entries (artistNameClassification) are left out.
  const performers: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.artists) {
    const key = normalizeArtistName(cleanArtistDisplayName(raw));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (classifyArtistName(raw).verdict === "not_artist") {
      flags.add("excluded_not_artist");
      continue;
    }
    performers.push(raw);
  }
  const add = (type: SignalType, artist: string, ex: string) => signals.push({ type, group: SIGNAL_GROUP[type], artist, excerpt: excerpt(ex) });

  const { prose, rooms } = splitDescription(input.description, input.artists);
  if (rooms.length > 1) flags.add("multi_room");
  if (input.sourceIds.length > 1) flags.add("multi_source");
  if (performers.length >= 12 || FESTIVAL_WORD.test(input.title)) flags.add("festival_like");

  // --- Strong: title ---
  const namedInTitle = performers.filter((a) => mentionIndex(input.title, a) >= 0);
  if (performers.length === 1) {
    add("only_performer", performers[0], input.title);
  } else if (namedInTitle.length >= 2 && namedInTitle.length === performers.length) {
    // The title is the whole lineup (Culture Box "Black Box: A, B · Red Box: C",
    // ALICE "A + B"): it says nothing about who headlines.
    flags.add("title_is_generated_lineup");
  } else {
    for (const a of namedInTitle) add("title_names_artist", a, input.title);
  }
  if (performers.length > 0 && fold(performers[0]) === fold(input.title) && performers.length > 1) {
    flags.add("title_is_lineup_entry");
  }

  // --- Strong: description cue (prose only) ---
  for (const sentence of sentences(prose)) {
    for (const a of cueSubjects(sentence, performers)) add("description_headline_cue", a, sentence);
  }

  // --- Strong: structured source field ---
  if (input.canonicalSourceId === "src-billetto") {
    if (input.sourceIds.length <= 1 && performers.length > 0 && performers.length <= 3) {
      for (const a of performers) add("structured_source_field", a, "Billetto headliners");
    } else {
      flags.add("billetto_headliners_unverified");
    }
  } else if (input.canonicalSourceId && TITLE_DERIVED_LINEUP_SOURCES.has(input.canonicalSourceId)) {
    flags.add("structured_role_not_stored");
  }

  // --- Supporting: order ---
  if (isAlphabetical(input.artists)) {
    flags.add("lineup_alphabetical");
  } else if (performers.length > 1) {
    add("lineup_first", performers[0], `first of ${performers.length} lineup entries`);
  }
  const mainRoom = rooms.find((r) => r.artists.length > 0);
  if (mainRoom && performers.length > 1 && !isAlphabetical(mainRoom.artists)) {
    const first = performers.find((a) => fold(a) === fold(mainRoom.artists[0]));
    if (first) add("main_room_first", first, `${mainRoom.room}: ${mainRoom.artists.join(", ")}`);
  }

  // --- Supporting: asset ---
  const file = input.imageUrl ? posterFileName(input.imageUrl) : null;
  if (file && performers.length > 1) {
    const fileSlug = `_${slug(file)}_`;
    for (const a of performers) {
      const s = slug(cleanArtistDisplayName(a));
      if (s.replace(/_/g, "").length >= 5 && fileSlug.includes(`_${s}_`)) add("poster_filename", a, file);
    }
  }

  // --- Supporting: prose ---
  let proseFirstMention: string | null = null;
  if (prose && performers.length > 1) {
    let best = Number.POSITIVE_INFINITY;
    for (const a of performers) {
      const i = mentionIndex(prose, a);
      if (i >= 0 && i < best) {
        best = i;
        proseFirstMention = a;
      }
    }
    if (proseFirstMention) add("description_first_mention", proseFirstMention, sentences(prose).find((s) => mentionIndex(s, proseFirstMention!) >= 0) ?? "");
  }

  // B2B written in the venue's own text but stored as separate entries.
  for (let i = 0; i < performers.length; i++) {
    for (let j = 0; j < performers.length; j++) {
      if (i === j) continue;
      const pattern = new RegExp(`${escapeRegExp(fold(performers[i]))}\\s+b2b\\s+${escapeRegExp(fold(performers[j]))}`, "u");
      if (pattern.test(fold(`${input.title}\n${prose}`))) flags.add("b2b_split");
    }
  }

  // --- Decide ---
  const byArtist = new Map<string, HeadlinerCandidate>();
  for (const s of signals) {
    const c = byArtist.get(s.artist) ?? { artist: s.artist, independentGroups: [], hasStrongSignal: false };
    if (s.group === "strong") c.hasStrongSignal = true;
    else if (!c.independentGroups.includes(s.group)) c.independentGroups.push(s.group);
    byArtist.set(s.artist, c);
  }
  const candidates = performers.map((a) => byArtist.get(a)).filter((c): c is HeadlinerCandidate => !!c);

  const strong = candidates.filter((c) => c.hasStrongSignal).map((c) => c.artist);
  if (strong.length > 0) {
    if (strong.length > 1) flags.add("equal_headliners");
    return { headliners: strong, confidence: "documented", signals, candidates, flags: [...flags], proseFirstMention };
  }
  const supported = candidates.filter((c) => c.independentGroups.length >= 2);
  if (supported.length === 1) {
    return { headliners: [supported[0].artist], confidence: "supported_prioritized", signals, candidates, flags: [...flags], proseFirstMention };
  }
  if (supported.length > 1) flags.add("conflicting_support");
  const weak = candidates.filter((c) => c.independentGroups.length >= 1);
  return {
    headliners: [],
    confidence: weak.length > 0 || supported.length > 1 ? "supported_insufficient" : "none",
    signals,
    candidates,
    flags: [...flags],
    proseFirstMention,
  };
}
