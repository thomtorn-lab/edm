import { stripDenAndenSideRoomPrefix } from "./denAndenSideRooms";

/**
 * Presentation-only helpers for the event listing. Never touches the
 * canonical `title`/`artists` data — these only decide what to render.
 */

// Pumpehuset's own source titles for its Byhaven pop-up series carry a
// literal "Byhaven: " prefix (real evidence: "Byhaven: Love.Rave",
// "Byhaven: Afro Sundown Fest" — see pumpehuset-fetch-concerts.json).
// Matched only at the START of the title, and only for Pumpehuset, so a
// title that genuinely contains "Byhaven" elsewhere (or a different
// venue's title that happens to start with the word) is never touched.
const BYHAVEN_PREFIX = /^Byhaven:\s*/;

// Culture Box's canonical title generation prefixes each room's own
// segment with its room name ("Black Box: X", "Red Box: Y", joined by
// " · " for a two-room night — see cultureBoxAdapter.ts's roomTitle()).
// Matched per " · "-delimited segment so it's applied uniformly to a
// single-room night ("Black Box: X") and a two-room night ("Black Box: X
// · Red Box: Y") alike, without needing to special-case either shape.
const CULTURE_BOX_ROOM_PREFIX = /^(?:Black Box|Red Box):\s*/;

/**
 * Public display title with internal venue/room structure removed —
 * canonical `title` is never modified, only what's rendered. Byhaven is a
 * Pumpehuset sub-area, not a separate venue; Black Box/Red Box are Culture
 * Box's internal rooms. Both are structural prefixes the venue's own
 * source text adds, not part of the event/series name itself, so they're
 * stripped from the primary public title while the underlying semantics
 * (which showcase/artists played which room) stay fully recoverable from
 * `description` (Culture Box's room-separated lineup breakdown) or
 * `subVenueLabel` below (Byhaven).
 *
 * Gated on the exact known venue name so this can never affect an
 * unrelated venue's title that happens to start with the same words.
 */
export function cleanEventTitle(title: string, venueName: string): string {
  if (venueName === "Pumpehuset") {
    const stripped = title.replace(BYHAVEN_PREFIX, "").trim();
    if (stripped !== title) return stripped;
  }
  if (venueName === "Den Anden Side") {
    // Same room-prefix model for Den Anden Side's two rooms ("Den Anden
    // Ende: X") — see src/lib/denAndenSideRooms.ts.
    const cleaned = stripDenAndenSideRoomPrefix(title);
    if (cleaned !== title) return cleaned;
  }
  if (venueName === "Culture Box") {
    // Room prefixes removed; the rooms' " · " separator becomes a plain
    // comma (2026-11-22) — without the room names it reads as one list.
    const segments = title.split(" · ").map((segment) => segment.replace(CULTURE_BOX_ROOM_PREFIX, "").trim());
    const cleaned = segments.filter(Boolean).join(", ");
    if (cleaned !== title) return cleaned;
  }
  return title;
}

/**
 * Secondary sub-area/room context for the event-detail page (never shown
 * in the listing — see EventRow, which only ever renders the clean
 * title). Culture Box's room-specific lineups already live in
 * `description` and don't need this. Pumpehuset's Byhaven area currently
 * has no equivalent per-event field, so it's derived from the raw
 * (unstripped) title here — evaluated against the same title
 * `cleanEventTitle` was given, before cleaning.
 *
 * `subVenue` (generalized sub-venue model, 2026-09-06) is the event's own
 * structural room field — see src/lib/types.ts's Venue.rooms/EventRecord.subVenue
 * — and always wins when present: it is real, persisted evidence, never
 * derived from title text, so it can never be contaminated by an
 * unrelated title that happens to start with a room-like word the way a
 * text-prefix heuristic could be. Optional and omittable so every
 * pre-existing call site (Byhaven/Culture Box, neither of which sets this
 * structural field) keeps behaving exactly as before, falling back to the
 * Pumpehuset title-prefix heuristic unchanged.
 */
export function subVenueLabel(title: string, venueName: string, subVenue?: string | null): string | null {
  if (subVenue) return subVenue;
  if (venueName === "Pumpehuset" && BYHAVEN_PREFIX.test(title)) return "Byhaven";
  return null;
}

function normalizeForComparison(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Connectors that join individual artists inside one lineup entry
// ("Qwenty b2b Ooops", "A B3B B", "A vs B", "A x B"). Each side is checked
// against the title on its own, so a b2b notation never keeps a lineup
// visible that the title already names in full.
const LINEUP_ENTRY_CONNECTOR = /\s+(?:b\d?b|vs\.?|x)\s+/i;

/**
 * Whether the listing-row lineup only repeats the event title (2026-11-22):
 * true when every individual lineup artist — entries split on b2b/b3b/vs/x —
 * appears in the displayed title as a whole name, compared case-, accent-
 * and punctuation-insensitively (room separators, commas and "&" ignored).
 * Any single artist missing from the title keeps the lineup visible, so no
 * artist ever disappears from the listing. Title "Blikfang" / lineup
 * "Blikfang" → true; Culture Box "STEAMBOI, …, LMN, QWENTY, OOOPS" / lineup
 * "… / Qwenty b2b Ooops" → true; "HYGGELIT SHOWCASE" → false.
 */
export function lineupDuplicatesTitle(title: string, artists: string[]): boolean {
  const names = artists
    .flatMap((entry) => entry.split(LINEUP_ENTRY_CONNECTOR))
    .map(normalizeForComparison)
    .filter(Boolean);
  if (names.length === 0) return false;
  const normalizedTitle = normalizeForComparison(title);
  if (!normalizedTitle) return false;
  const paddedTitle = ` ${normalizedTitle} `;
  return names.every((name) => paddedTitle.includes(` ${name} `));
}

/**
 * Whether the grey artist/lineup preview should be shown next to the event
 * title. The preview is redundant — and should be suppressed — when the
 * canonical title already names all, or effectively all, of the artists it
 * would otherwise repeat (e.g. a per-room lineup title like "Black Box: A, B
 * · Red Box: C, D"). It stays visible when the title is a distinct
 * event/showcase name that doesn't already carry the lineup (e.g. "HYGGELIT
 * SHOWCASE"). A single coincidental name match out of a longer lineup is
 * never enough on its own to suppress it.
 */
export function shouldShowArtistPreview(title: string, artists: string[]): boolean {
  if (artists.length === 0) return false;

  const normalizedTitle = normalizeForComparison(title);
  if (!normalizedTitle) return true;
  const paddedTitle = ` ${normalizedTitle} `;

  let foundCount = 0;
  for (const artist of artists) {
    const normalizedArtist = normalizeForComparison(artist);
    if (normalizedArtist && paddedTitle.includes(` ${normalizedArtist} `)) {
      foundCount += 1;
    }
  }

  const total = artists.length;
  if (foundCount === total) return false;
  // Tolerate one missing match only once the lineup is long enough that a
  // single coincidental match can't masquerade as "effectively all".
  if (total >= 3 && foundCount >= total - 1) return false;
  return true;
}

/**
 * Verified official spellings (2026-11-25), keyed in lower case. They win over
 * both the source data and the default casing below. Keep this list short and
 * add a name only once its spelling is confirmed.
 */
const VERIFIED_ARTIST_SPELLINGS = new Map(
  ["steamboi", "avoN", "LMN", "KI/KI", "BICEP", "ANNA", "SHERELLE", "BUNT."].map((name) => [verifiedKey(name), name]),
);

/** Lookup key for a verified spelling: lower case, a trailing full stop ignored ("BUNT" and "BUNT." both find "BUNT."). */
function verifiedKey(name: string): string {
  return name.toLocaleLowerCase().replace(/\.$/, "");
}

const VOWEL = /[AEIOUYÆØÅÄÖÜÉÈÊÁÀÍÓÚ]/u;

/**
 * Default display casing for an artist name the source writes entirely in
 * capitals: each word gets a capital first letter ("KARDINAL BERTRAM" →
 * "Kardinal Bertram", "SILK!" → "Silk!"). A word is left as written when it
 * has no vowel (LMN, DJ, (DK)), is a single letter (P), or holds digits,
 * symbols or non-Latin letters (EL*VIRA, 2LATE, ULDΛLL) — those are usually
 * deliberate. A name that is not
 * all capitals (avoN, Ooops) is the source's own spelling and is kept.
 */
function defaultArtistCase(name: string): string {
  if (name !== name.toLocaleUpperCase() || !/\p{L}/u.test(name)) return name;
  return name
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) => (/^[A-ZÆØÅÄÖÜÉÈÊÁÀÍÓÚÑÇ]{2,}[!?.']*$/u.test(part) && VOWEL.test(part) ? part[0] + part.slice(1).toLocaleLowerCase() : part))
        .join("-"),
    )
    .join(" ");
}

/** The display spelling of one artist name: verified spelling, else the source's mixed-case spelling, else the default casing. */
export function artistDisplaySpelling(name: string): string {
  return VERIFIED_ARTIST_SPELLINGS.get(verifiedKey(name)) ?? defaultArtistCase(name);
}

/** Separators allowed between artist names in an artist-only title; b2b/b3b/vs/x are shown in lower case. */
const ARTIST_TITLE_SEPARATOR = /^(?:\s*(?:\/|,|&|\+|·|\||;)\s*|\s+(b\d?b|vs\.?|x)\s+)/i;

/**
 * Display casing for an event title that consists only of the event's own
 * artist names (listing, 2026-11-25). When the whole title can be read as
 * names from `artists` — each compared case-insensitively, also without a
 * trailing "(DJ set)"-style qualifier — joined only by separators (/ , & + ·
 * | ; b2b b3b vs x), every name is shown with artistDisplaySpelling(): a
 * verified spelling first (steamboi, avoN, LMN, KI/KI, BICEP, ANNA,
 * SHERELLE, BUNT.), else
 * the source's own mixed-case spelling, else the default casing for an
 * all-capitals name ("KARDINAL BERTRAM" → "Kardinal Bertram"); b2b/vs/x in
 * lower case. Culture Box's room labels are already removed by
 * cleanEventTitle() before this runs. Any other text in the title (an event
 * name, a concept) returns the title unchanged. Display only; the stored
 * title is untouched.
 */
export function artistTitleDisplay(title: string, artists: string[]): string {
  const names = new Map<string, string>();
  for (const entry of artists) {
    for (const raw of [entry, ...entry.split(LINEUP_ENTRY_CONNECTOR)]) {
      const name = formatArtistName(raw);
      const bare = name.replace(/\s*\([^)]*\)$/, "").trim();
      for (const n of [name, bare]) {
        const key = n.toLocaleLowerCase();
        const known = names.get(key);
        if (n && (!known || (known === known.toLocaleUpperCase() && n !== n.toLocaleUpperCase()))) names.set(key, n);
      }
    }
  }
  if (names.size === 0) return title;
  const candidates = [...names.entries()].sort((a, b) => b[0].length - a[0].length);
  let rest = title.trim();
  let out = "";
  let expectName = true;
  while (rest) {
    if (expectName) {
      const lower = rest.toLocaleLowerCase();
      const hit = candidates.find(([key]) => lower.startsWith(key) && (rest.length === key.length || ARTIST_TITLE_SEPARATOR.test(rest.slice(key.length))));
      if (!hit) return title;
      out += artistDisplaySpelling(hit[1]);
      rest = rest.slice(hit[0].length);
    } else {
      const sep = rest.match(ARTIST_TITLE_SEPARATOR);
      if (!sep) return title;
      out += sep[1] ? ` ${sep[1].toLowerCase()} ` : sep[0];
      rest = rest.slice(sep[0].length);
    }
    expectName = !expectName;
  }
  return expectName ? title : out;
}

/**
 * Public display of an artist name (2026-11-22): the official spelling as
 * the source gives it, casing included ("avoN", "LMN", "Silk!" stay as
 * written) — only stray whitespace is tidied. Presentation-only; canonical
 * `artists` data is never modified.
 */
export function formatArtistName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
