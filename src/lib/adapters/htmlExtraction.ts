/**
 * Small, source-agnostic HTML text-extraction primitives shared by every
 * first-party HTML adapter. Structural parsing — which elements on a given
 * site mean "date", "room", "lineup" — stays local to each adapter (sites
 * differ too much to force into one generic template); only the
 * "make sense of raw markup as plain text" helpers are genuinely identical
 * across sources, first proven by hangarenAdapter.ts and reused as-is by
 * cultureBoxAdapter.ts rather than re-implemented.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (full, name) => NAMED_ENTITIES[name] ?? full);
}

/** Renders an HTML fragment to plain text the way a browser would display it. */
export function htmlToText(html: string): string {
  const withoutStyleScript = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const withBreaks = withoutStyleScript
    // Matches a bare <br>/<br/> as well as an attributed variant like
    // <br class="html-br" /> (real evidence: a Pumpehuset lineup list used
    // exactly this to separate names — without this, "Leeni & Danilo
    // Kupfernagel", "Lush" and "NILU" would silently concatenate into one
    // run-on string with no separator at all).
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  const decoded = decodeHtmlEntities(stripped);
  return decoded
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/** Every `<a ...>TEXT</a>` anchor's decoded, trimmed text within an HTML fragment, in document order. */
export function extractAnchorTexts(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*>([^<]*)<\/a>/gi)) {
    const text = decodeHtmlEntities(m[1]).trim();
    if (text) out.push(text);
  }
  return out;
}

/** The lowest DKK amount mentioned in a fragment of price text (e.g. "150 DKK / 100 DKK after 6AM" -> 100). */
export function extractLowestDkkAmount(text: string): number | null {
  const amounts = [...text.matchAll(/(\d+)\s*DKK/gi)].map((m) => Number(m[1]));
  if (amounts.length === 0) return null;
  return Math.min(...amounts);
}

/**
 * Strips obvious standalone URLs out of free text without destroying
 * legitimate surrounding text — a conservative guard against a raw URL
 * (e.g. a SoundCloud link an artist listed next to their own name) leaking
 * through as if it were display text, in an artist/lineup entry or similar.
 * Only the URL substring itself is removed; real words around it are kept.
 */
export function stripBareUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s:;,–—-]+|[\s:;,–—-]+$/g, "")
    .trim();
}
