/**
 * Presentation-only helpers for the event listing. Never touches the
 * canonical `title`/`artists` data — these only decide what to render.
 */

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
