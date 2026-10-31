/**
 * Den Anden Side room structure (2026-10-27) — the Culture Box model
 * (cultureBoxAdapter.ts / cultureBoxConsolidation.ts) applied to Den Anden
 * Side's two rooms:
 *
 *   - "Den Anden Side" — the main room, same name as the club
 *   - "Den Anden Ende" — the smaller room
 *
 * Both rooms belong to venue v-den-anden-side; "Den Anden Ende" is never a
 * venue of its own. Like Culture Box, room structure lives in the event's
 * own fields, never a separate rooms table:
 *
 *   - title: a night held entirely in the small room is "Den Anden Ende: X"
 *     (Culture Box's "Black Box: X"), stripped back to "X" for display by
 *     cleanEventTitle(). A night using both rooms keeps its own event name
 *     (Culture Box's shared-identity title).
 *   - description: a room-separated lineup breakdown, one block per room
 *     ("Den Anden Side\nA, B\n\nDen Anden Ende\nC"), placed after the
 *     source's own About text and before its practical tail.
 *   - artists: main room first, then Den Anden Ende — the same set, never
 *     more, never fewer.
 *
 * Unlike Culture Box, Den Anden Side's sources (Resident Advisor text,
 * HvadErPå, Billetto, admin-pasted copy) publish no structured room
 * blocks, so the room split is read from explicit text only: a title or
 * venue naming "Den Anden Ende", or lineup headings naming a room followed
 * by the artists playing there. Anything less certain — no headings, a
 * heading for a room without its name ("Room 2", "main floor"), an artist
 * listed under both rooms, an artist under no room — keeps the lineup
 * combined and is reported as unresolved. Never guessed.
 *
 * Pure and idempotent: structuring an already-structured event returns it
 * unchanged, so the pipeline (every future import), the sync patch guard
 * and the one-time migration (src/db/denAndenSideRoomStructure.ts) all
 * converge on the same stored shape.
 */

export const DEN_ANDEN_SIDE_VENUE_ID = "v-den-anden-side";

/**
 * Whether imports and syncs apply this room model (Vercel env var
 * DAS_ROOMS_ENABLED="true"). Off by default, so the code can ship inert:
 * stored events are reviewed first with the read-only plan
 * (src/db/denAndenSideRoomStructure.ts --mode=plan), then this is switched
 * on and the plan applied. Display and the one-time script don't read it.
 */
export function isDenAndenSideRoomsEnabled(): boolean {
  return process.env.DAS_ROOMS_ENABLED === "true";
}
export const MAIN_ROOM = "Den Anden Side";
export const SMALL_ROOM = "Den Anden Ende";
export type DasRoom = typeof MAIN_ROOM | typeof SMALL_ROOM;
const ROOM_ORDER: DasRoom[] = [MAIN_ROOM, SMALL_ROOM];

/** Venue strings meaning Den Anden Side (registry name + aliases, src/lib/data/venues.ts) or its small room. */
const DAS_VENUE_NAMES = ["den anden side", "das", "den anden side copenhagen", "den anden side amager"];

function norm(text: string, { keepBrackets = false } = {}): string {
  let t = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (!keepBrackets) t = t.replace(/[[(][^\])]*[\])]/g, " "); // pronouns / notes: "[she/her]", "(live)"
  return t
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSmallRoomVenueName(name: string | null | undefined): boolean {
  return !!name && norm(name) === norm(SMALL_ROOM);
}

/** True for any raw venue string that means Den Anden Side, including its small room. */
export function isDenAndenSideVenueName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = norm(name);
  return DAS_VENUE_NAMES.includes(n) || n === norm(SMALL_ROOM);
}

// ------------------------------------------------------------ title

const SMALL_ROOM_TITLE_PREFIX = /^Den Anden Ende:\s*/i;
// "X at Den Anden Ende" / "X @ Den Anden Ende" / "X - Den Anden Ende" (RA, HvadErPå)
const SMALL_ROOM_TITLE_SUFFIX = /\s*(?:\bat\b|@|[-–—|])\s*Den Anden Ende\s*$/i;

function titleNamesSmallRoom(title: string): boolean {
  return SMALL_ROOM_TITLE_PREFIX.test(title) || SMALL_ROOM_TITLE_SUFFIX.test(title);
}

function smallRoomTitle(title: string): string {
  const core = title.replace(SMALL_ROOM_TITLE_PREFIX, "").replace(SMALL_ROOM_TITLE_SUFFIX, "").trim();
  return core ? `${SMALL_ROOM}: ${core}` : SMALL_ROOM;
}

/** A title without any room prefix/suffix this module adds or reads. */
function baseTitle(title: string): string {
  return title.replace(SMALL_ROOM_TITLE_PREFIX, "").replace(SMALL_ROOM_TITLE_SUFFIX, "").trim() || title;
}

// ------------------------------------------------------ room headings

const SEPARATOR_RE = /^(?:[—–]{3,}|-{4,}|_{4,}|={4,}|\*{3,})$/;
// Same section titles descriptionFormat.ts treats as the practical tail.
const PRACTICAL_RE =
  /^(?:admission|entry|entrance|tickets?|ticket info(?:rmation)?|billetter|entree?|prices?|priser|age(?: limit)?|aldersgr\w*nse|wardrobe|garderobe|cloakroom|door ?policy|d\w*rpolitik|code of conduct|house rules|vibe vision|awareness|safer? spaces?(?: policy)?|accessibility|tilg\w*ngelighed|practical info(?:rmation)?|praktisk info(?:rmation)?|praktiske oplysninger)$/i;
// A heading for a room that does not say which one ("Room 2:", "Main floor:",
// "FEUM takeover:", "Floor 1") — ends the current room's section, assigns nothing.
const UNNAMED_ROOM_HEADING_RE = /\b(?:room|rum|floor|dancefloor|dansegulv|stage|scene|takeover|area)\b/i;

function plainLine(line: string): string {
  // Math-bold "𝗟𝗶𝗻𝗲𝘂𝗽" and friends fold to ASCII under NFKD.
  return line.normalize("NFKD").replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, "").trim();
}

function isPracticalHeading(line: string): boolean {
  return PRACTICAL_RE.test(plainLine(line).replace(/[\s:.\-–—]+$/, "").trim());
}

interface RoomHeading {
  room: DasRoom;
  /** The source's own name for what happens in the room ("FEUM takeover"), if any. */
  label: string | null;
  /** Text after the heading on the same line ("Den Anden Ende: A, B" → "A, B"). */
  inline: string;
}

// Headings that name a room by what it is rather than by name — the main
// room is Den Anden Side, the small room Den Anden Ende. Real evidence: RA
// 2131356 (Fast Forward x Bassiani) heads its lineup "MAIN FLOOR:" and
// "FEUM TAKEOVER @ DEN ANDEN ENDE:". Numbered rooms ("Room 1", "Room 2") are
// NOT mapped: RA 2535456 numbers them the other way round from its own
// timetable.
const MAIN_ROOM_SYNONYM_RE = /^(?:main ?(?:floor|room|stage|dancefloor)|hovedrum(?:met)?|hovedgulv(?:et)?)\s*(?::\s*(.*))?$/i;
const SMALL_ROOM_SYNONYM_RE = /^(?:small(?:er)? ?(?:floor|room|dancefloor)|lille ?rum(?:met)?)\s*(?::\s*(.*))?$/i;

/**
 * A short line naming exactly one room: "Den Anden Ende", "Den Anden Ende:",
 * "Main floor (Den Anden Side): A, B", "FEUM takeover @ Den Anden Ende",
 * "MAIN FLOOR:". Prose ("Below you'll find ... before you go to Den Anden
 * Side.") is not a heading: too long, or sentence-shaped before the room name.
 */
function roomHeading(line: string): RoomHeading | null {
  const plain = plainLine(line);
  const n = norm(plain, { keepBrackets: true }); // "Main floor (Den Anden Side): ..."
  const side = n.includes("den anden side");
  const ende = n.includes("den anden ende");
  if (!side && !ende) {
    const main = plain.match(MAIN_ROOM_SYNONYM_RE);
    if (main) return { room: MAIN_ROOM, label: null, inline: (main[1] ?? "").trim() };
    const small = plain.match(SMALL_ROOM_SYNONYM_RE);
    if (small) return { room: SMALL_ROOM, label: null, inline: (small[1] ?? "").trim() };
    return null;
  }
  if (side && ende) return null;
  const room = ende ? SMALL_ROOM : MAIN_ROOM;
  const m = plain.match(/den anden (?:side|ende)\)?\s*[:\-–—]?\s*/i);
  if (!m || m.index === undefined) return null;
  const before = plain.slice(0, m.index);
  let after = plain.slice(m.index + m[0].length).trim();
  if (before.split(/\s+/).filter(Boolean).length > 4) return null;
  if (/[.!?]\s/.test(before) || /[.!?]$/.test(before.trim())) return null;
  // "Den Anden Ende (FEUM takeover): A" — the form room blocks are written in.
  let label = headingLabel(before);
  const paren = after.match(/^\(([^)]*)\)\s*:?\s*/);
  if (paren && !label) {
    label = headingLabel(paren[1]);
    after = after.slice(paren[0].length).trim();
  }
  // With text after the room name it must read as a lineup ("A, B, C"), not a sentence.
  if (after && (/[.!?]$/.test(after) || (after.split(/\s+/).length > 6 && !after.includes(",")))) return null;
  return { room, label, inline: after };
}

/**
 * The text a heading puts before the room name, kept as the room's label
 * ("FEUM TAKEOVER @" → "FEUM TAKEOVER"). Generic room words ("Main floor",
 * "Room 2") say nothing the room name doesn't, so they are dropped.
 */
function headingLabel(text: string): string | null {
  const t = entryText(text)
    .replace(/[(@:\-–—|]+\s*$/, "")
    .replace(/\s+(?:at|in|i|på)$/i, "")
    .replace(/^[(\s]+|[\s)]+$/g, "")
    .trim();
  if (!t) return null;
  if (MAIN_ROOM_SYNONYM_RE.test(t) || SMALL_ROOM_SYNONYM_RE.test(t)) return null;
  if (/^(?:room|rum|floor|stage|scene)\s*\d*$/i.test(t)) return null;
  return t;
}

function isUnnamedRoomHeading(line: string): boolean {
  const plain = plainLine(line);
  if (!plain || plain.split(/\s+/).length > 6) return false;
  return UNNAMED_ROOM_HEADING_RE.test(plain) && (/[:]$/.test(plain) || /^\S+(?:\s+\S+)?\s*\d*\s*[:(]/.test(plain) || /^(?:room|rum|floor)\s*\d/i.test(plain));
}

function lineMentions(line: string, artist: string): boolean {
  const a = norm(artist);
  if (!a) return false;
  return ` ${norm(line)} `.includes(` ${a} `);
}

// ------------------------------------------------- generated blocks

/** One room block: the room name, then that room's lineup entries on one line. */
function blockFor(room: DasRoom, entries: string[], label: string | null = null): string {
  return `${label ? `${room} (${label})` : room}\n${entries.length > 0 ? entries.join(", ") : "Lineup TBA"}`;
}

const BLOCK_HEADING_RE = /^(Den Anden Side|Den Anden Ende)(?: \(([^)]+)\))?$/;

/**
 * Whether a paragraph is a room block (generated, or already in the source):
 * exactly a room name, then one line naming at least one of this event's
 * artists that doesn't read as a sentence. A source paragraph that merely
 * starts with a room name ("Den Anden Side\nAxeltorv 5") is never one.
 */
function isRoomBlock(paragraph: string, artists: string[]): boolean {
  const lines = paragraph.split("\n");
  if (lines.length !== 2 || !BLOCK_HEADING_RE.test(lines[0])) return false;
  if (lines[1] === "Lineup TBA") return true;
  if (/[.!?]$/.test(lines[1].trim())) return false;
  return artists.some((a) => lineMentions(lines[1], a));
}

/** The room blocks currently in a description (room → its lineup line), if any. */
export function readGeneratedBreakdown(description: string | null, artists: string[]): Partial<Record<DasRoom, string>> | null {
  if (!description) return null;
  const found: Partial<Record<DasRoom, string>> = {};
  for (const p of description.split(/\n{2,}/)) {
    if (!isRoomBlock(p, artists)) continue;
    const [heading, list] = p.split("\n");
    found[heading.match(BLOCK_HEADING_RE)![1] as DasRoom] = list;
  }
  return Object.keys(found).length > 0 ? found : null;
}

/** Display text of a source lineup line: styled letters folded (NFKC keeps "é", "ø"). */
function entryText(line: string): string {
  return line.normalize("NFKC").replace(/[​-‏⁠﻿]/g, "").replace(/\s+/g, " ").trim();
}

const LINEUP_HEADING_RE = /^line[\s-]?up$/i;

interface LineupRegion {
  /** First line index replaced by the room blocks. */
  start: number;
  /** One past the last line replaced. */
  end: number;
  entries: Partial<Record<DasRoom, string[]>>;
  labels: Partial<Record<DasRoom, string>>;
}

/**
 * The source's own lineup section, read into per-room entries so the room
 * blocks can REPLACE it rather than repeat it: from just after a "Lineup"
 * heading (or from the first room heading when there is none) through every
 * following line that is a room heading or names one of the event's
 * artists, up to the first separator, practical heading or other text.
 * Entries keep the source's own wording — "Schacke B2B Vixen", "[she/her]",
 * "(live)". Returns null (append instead, replacing nothing) whenever the
 * section doesn't map cleanly onto the verified rooms: an entry outside any
 * room, an entry naming an artist the analysis put in the other room, or an
 * artist missing from the section.
 */
function findLineupRegion(lines: string[], analysis: RoomAnalysis, artists: string[]): LineupRegion | null {
  const headingAt = lines.findIndex((l) => LINEUP_HEADING_RE.test(plainLine(l).replace(/[\s:]+$/, "")));
  let start = headingAt >= 0 ? headingAt + 1 : lines.findIndex((l) => roomHeading(l) !== null);
  if (start < 0) return null;
  while (start < lines.length && !lines[start].trim()) start++;

  const singleRoom: DasRoom | null =
    analysis.verdict === "small-room-only" ? SMALL_ROOM : analysis.verdict === "main-room-only" ? MAIN_ROOM : null;
  const roomOf = (a: string): DasRoom | null => ROOM_ORDER.find((r) => analysis.rooms[r]?.includes(a)) ?? null;
  const entries: Partial<Record<DasRoom, string[]>> = {};
  const labels: Partial<Record<DasRoom, string>> = {};
  const seen = new Set<string>();
  let current: DasRoom | null = null;
  let end = start;

  const take = (text: string, room: DasRoom | null): boolean => {
    const named = artists.filter((a) => lineMentions(text, a));
    if (named.length === 0) return true;
    const target = room ?? singleRoom;
    if (!target || named.some((a) => roomOf(a) !== target)) return false;
    named.forEach((a) => seen.add(a));
    (entries[target] ??= []).push(entryText(text));
    return true;
  };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (SEPARATOR_RE.test(plainLine(line)) || isPracticalHeading(line)) break;
    const heading = roomHeading(line);
    if (heading) {
      current = heading.room;
      if (heading.label) {
        if (labels[current] && labels[current] !== heading.label) return null; // two names for one room
        labels[current] = heading.label;
      }
      if (heading.inline && !take(heading.inline, current)) return null;
      end = i + 1;
      continue;
    }
    if (isUnnamedRoomHeading(line)) return null;
    if (line === "Lineup TBA" && current) {
      end = i + 1; // a room block written for a room with no names yet
      continue;
    }
    if (!artists.some((a) => lineMentions(line, a))) break;
    if (!take(line, current)) return null;
    end = i + 1;
  }

  if (end === start || artists.some((a) => !seen.has(a))) return null;
  return { start, end, entries, labels };
}

/**
 * Puts the room blocks in place of the source's own lineup section when it
 * maps cleanly (no lineup shown twice), otherwise just before the source's
 * practical tail (its first Admission/Age/Door policy/... section, with the
 * separator line in front of it), or at the end when it has none.
 */
function placeBreakdown(description: string | null, analysis: RoomAnalysis, artists: string[]): string {
  const lines = (description ?? "").split("\n");
  const region = description ? findLineupRegion(lines, analysis, artists) : null;
  const blocks = (entries: Partial<Record<DasRoom, string[]>>, labels: Partial<Record<DasRoom, string>> = {}) =>
    ROOM_ORDER.filter((r) => analysis.rooms[r]).map((r) => blockFor(r, entries[r] ?? [], labels[r] ?? null)).join("\n\n");

  if (region) {
    const head = lines.slice(0, region.start).join("\n").trimEnd();
    const tail = lines.slice(region.end).join("\n").replace(/^\s*\n/, "").trimEnd();
    return [head, blocks(region.entries, region.labels), tail].filter(Boolean).join("\n\n");
  }

  const breakdown = blocks(analysis.rooms);
  if (!description?.trim()) return breakdown;
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isPracticalHeading(lines[i])) {
      cut = i;
      while (cut > 0 && (SEPARATOR_RE.test(plainLine(lines[cut - 1])) || !lines[cut - 1].trim())) cut--;
      break;
    }
  }
  if (cut <= 0) return `${description.trimEnd()}\n\n${breakdown}`;
  const head = lines.slice(0, cut).join("\n").trimEnd();
  const tail = lines.slice(cut).join("\n").replace(/^\n+/, "");
  return `${head}\n\n${breakdown}\n\n${tail}`;
}

// ------------------------------------------------------ analysis

export type RoomVerdict =
  /** Both rooms, every artist placed in exactly one. */
  | "two-rooms"
  /** Whole night in Den Anden Ende (title/venue says so, or every artist is listed there). */
  | "small-room-only"
  /** Every artist explicitly listed under Den Anden Side, nothing in Den Anden Ende. */
  | "main-room-only"
  /** No room information in the source text — combined lineup kept, nothing to resolve. */
  | "no-room-info"
  /** Room information exists but can't be verified — combined lineup kept, needs a human. */
  | "unresolved";

export interface RoomAnalysis {
  verdict: RoomVerdict;
  rooms: Partial<Record<DasRoom, string[]>>;
  reason: string;
}

// Text that talks about a second room without a parseable split.
const SECOND_ROOM_HINT_RE =
  /\b(?:den anden ende|second (?:room|floor|dancefloor)|small(?:er)? (?:room|floor|dancefloor)|room ?(?:2|two|ii)|two rooms|both rooms|andet rum|lille rum|det lille|takeover of the second)\b/i;

export interface RoomInput {
  title: string;
  description: string | null;
  artists: string[];
  venueName?: string | null;
}

export function analyzeRooms(input: RoomInput): RoomAnalysis {
  const { title, description, artists } = input;
  const smallByTitle = titleNamesSmallRoom(title) || isSmallRoomVenueName(input.venueName);

  // Lineup headings in the description.
  const assigned = new Map<string, Set<DasRoom>>();
  let headingCount = 0;
  let current: DasRoom | null = null;
  let sawArtistUnderCurrent = false;
  for (const raw of (description ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (sawArtistUnderCurrent) current = null; // a blank line ends a room's list (not one right after its heading)
      continue;
    }
    if (SEPARATOR_RE.test(plainLine(line)) || isPracticalHeading(line)) {
      current = null;
      continue;
    }
    const heading = roomHeading(line);
    if (heading) {
      headingCount++;
      current = heading.room;
      sawArtistUnderCurrent = false;
      if (heading.inline) {
        for (const a of artists) {
          if (lineMentions(heading.inline, a)) {
            (assigned.get(a) ?? assigned.set(a, new Set()).get(a)!).add(current);
            sawArtistUnderCurrent = true;
          }
        }
      }
      continue;
    }
    if (isUnnamedRoomHeading(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    for (const a of artists) {
      if (lineMentions(line, a)) {
        (assigned.get(a) ?? assigned.set(a, new Set()).get(a)!).add(current);
        sawArtistUnderCurrent = true;
      }
    }
  }

  const empty: Partial<Record<DasRoom, string[]>> = {};

  if (assigned.size === 0) {
    if (smallByTitle) {
      return { verdict: "small-room-only", rooms: { [SMALL_ROOM]: [...artists] }, reason: "title/venue names Den Anden Ende and no lineup heading places anyone elsewhere" };
    }
    if (headingCount > 0 && artists.length > 0) {
      return { verdict: "unresolved", rooms: empty, reason: "room headings found, but none of the event's artists could be matched under them" };
    }
    const text = `${title}\n${description ?? ""}`;
    if (SECOND_ROOM_HINT_RE.test(text)) {
      return { verdict: "unresolved", rooms: empty, reason: "source mentions a second room but gives no explicit per-room lineup" };
    }
    return { verdict: "no-room-info", rooms: empty, reason: "no room information in the source text" };
  }

  const conflicts = [...assigned].filter(([, rooms]) => rooms.size > 1).map(([a]) => a);
  if (conflicts.length > 0) {
    return { verdict: "unresolved", rooms: empty, reason: `listed under both rooms: ${conflicts.join(", ")}` };
  }
  const unplaced = artists.filter((a) => !assigned.has(a));
  if (unplaced.length > 0) {
    return { verdict: "unresolved", rooms: empty, reason: `not placed in any room: ${unplaced.join(", ")}` };
  }

  const rooms: Partial<Record<DasRoom, string[]>> = {};
  for (const room of ROOM_ORDER) {
    const list = artists.filter((a) => assigned.get(a)!.has(room));
    if (list.length > 0) rooms[room] = list;
  }
  const hasMain = !!rooms[MAIN_ROOM];
  const hasSmall = !!rooms[SMALL_ROOM];
  if (smallByTitle && hasMain) {
    return { verdict: "unresolved", rooms: empty, reason: "title/venue says Den Anden Ende, but the lineup places artists in Den Anden Side" };
  }
  if (hasMain && hasSmall) return { verdict: "two-rooms", rooms, reason: "explicit per-room lineup headings, every artist in exactly one room" };
  if (hasSmall) return { verdict: "small-room-only", rooms, reason: "every artist listed under Den Anden Ende" };
  return { verdict: "main-room-only", rooms, reason: "every artist listed under Den Anden Side" };
}

// ------------------------------------------------------ structuring

export interface StructuredRooms {
  title: string;
  description: string | null;
  artists: string[];
  analysis: RoomAnalysis;
  /** True when title/description/artists differ from the input. */
  changed: boolean;
}

/**
 * The Culture Box-shaped title/description/artists for a Den Anden Side
 * event. Unverifiable room information leaves everything exactly as it was.
 */
export function structureDenAndenSideRooms(input: RoomInput): StructuredRooms {
  const analysis = analyzeRooms(input);
  const unchanged = { title: input.title, description: input.description, artists: input.artists, analysis, changed: false };
  if (analysis.verdict === "no-room-info" || analysis.verdict === "unresolved") return unchanged;

  const artists = ROOM_ORDER.flatMap((r) => analysis.rooms[r] ?? []);
  const title = analysis.verdict === "small-room-only" ? smallRoomTitle(input.title) : baseTitle(input.title);
  const description = placeBreakdown(input.description, analysis, input.artists);

  const changed =
    title !== input.title ||
    description !== input.description ||
    artists.length !== input.artists.length ||
    artists.some((a, i) => a !== input.artists[i]);
  return { title, description, artists, analysis, changed };
}

/** Display title: room prefix removed per " · " segment, as cleanEventTitle does for Culture Box. */
export function stripDenAndenSideRoomPrefix(title: string): string {
  return title
    .split(" · ")
    .map((s) => s.replace(/^(?:Den Anden Side|Den Anden Ende):\s*/, "").trim())
    .join(" · ");
}
