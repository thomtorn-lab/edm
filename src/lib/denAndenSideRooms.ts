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
    if (main) return { room: MAIN_ROOM, inline: (main[1] ?? "").trim() };
    const small = plain.match(SMALL_ROOM_SYNONYM_RE);
    if (small) return { room: SMALL_ROOM, inline: (small[1] ?? "").trim() };
    return null;
  }
  if (side && ende) return null;
  const room = ende ? SMALL_ROOM : MAIN_ROOM;
  const m = plain.match(/den anden (?:side|ende)\)?\s*[:\-–—]?\s*/i);
  if (!m || m.index === undefined) return null;
  const before = plain.slice(0, m.index);
  const after = plain.slice(m.index + m[0].length).trim();
  if (before.split(/\s+/).filter(Boolean).length > 4) return null;
  if (/[.!?]\s/.test(before) || /[.!?]$/.test(before.trim())) return null;
  // With text after the room name it must read as a lineup ("A, B, C"), not a sentence.
  if (after && (/[.!?]$/.test(after) || (after.split(/\s+/).length > 6 && !after.includes(",")))) return null;
  return { room, inline: after };
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

function blockFor(room: DasRoom, artists: string[]): string {
  return `${room}\n${artists.length > 0 ? artists.join(", ") : "Lineup TBA"}`;
}

/**
 * Whether a paragraph is a room block this module generated: exactly the
 * room name, then a line made only of this event's artist names (or
 * "Lineup TBA"). A source paragraph that merely starts with a room name
 * ("Den Anden Side\nAxeltorv 5") is never mistaken for one.
 */
function isGeneratedBlock(paragraph: string, artists: string[]): boolean {
  const lines = paragraph.split("\n");
  if (lines.length !== 2 || (lines[0] !== MAIN_ROOM && lines[0] !== SMALL_ROOM)) return false;
  if (lines[1] === "Lineup TBA") return true;
  const known = new Set(artists);
  return lines[1].split(", ").every((name) => known.has(name));
}

/** Removes room blocks this module generated earlier, so re-structuring never stacks them. */
function stripGeneratedBlocks(description: string | null, artists: string[]): string | null {
  if (!description) return description;
  const kept = description.split(/\n{2,}/).filter((p) => !isGeneratedBlock(p, artists));
  const out = kept.join("\n\n").trim();
  return out || null;
}

/** The generated room breakdown currently in a description, if any. */
export function readGeneratedBreakdown(description: string | null, artists: string[]): Partial<Record<DasRoom, string[]>> | null {
  if (!description) return null;
  const found: Partial<Record<DasRoom, string[]>> = {};
  for (const p of description.split(/\n{2,}/)) {
    if (!isGeneratedBlock(p, artists)) continue;
    const [room, list] = p.split("\n");
    found[room as DasRoom] = list === "Lineup TBA" ? [] : list.split(", ");
  }
  return Object.keys(found).length > 0 ? found : null;
}

/**
 * Puts the room breakdown after the About text: just before the source's own
 * practical tail (its first Admission/Age/Door policy/... section, together
 * with the separator line in front of it), or at the end when it has none.
 */
function insertBreakdown(description: string | null, breakdown: string, artists: string[]): string {
  const base = stripGeneratedBlocks(description, artists);
  if (!base) return breakdown;
  const lines = base.split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isPracticalHeading(lines[i])) {
      cut = i;
      while (cut > 0 && (SEPARATOR_RE.test(plainLine(lines[cut - 1])) || !lines[cut - 1].trim())) cut--;
      break;
    }
  }
  if (cut <= 0) return `${base}\n\n${breakdown}`;
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

  const breakdown = ROOM_ORDER.filter((r) => analysis.rooms[r])
    .map((r) => blockFor(r, analysis.rooms[r]!))
    .join("\n\n");
  const artists = ROOM_ORDER.flatMap((r) => analysis.rooms[r] ?? []);
  const title = analysis.verdict === "small-room-only" ? smallRoomTitle(input.title) : baseTitle(input.title);
  const description = insertBreakdown(input.description, breakdown, input.artists);

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
