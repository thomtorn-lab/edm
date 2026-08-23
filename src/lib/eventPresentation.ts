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
  if (venueName === "Culture Box") {
    const cleaned = title
      .split(" · ")
      .map((segment) => segment.replace(CULTURE_BOX_ROOM_PREFIX, "").trim())
      .join(" · ");
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
 */
export function subVenueLabel(title: string, venueName: string): string | null {
  if (venueName === "Pumpehuset" && BYHAVEN_PREFIX.test(title)) return "Byhaven";
  return null;
}

function normalizeForComparison(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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
