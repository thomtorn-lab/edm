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

// Non-breaking / narrow-no-break space variants — a raw U+00A0 (as opposed
// to an &nbsp; entity, which decodeHtmlEntities above already turns into a
// real space) survives untouched through tag-stripping and entity-decoding
// alike, since neither operation is a whitespace pass. Real evidence: Culture
// Box event descriptions carry the literal character (not the entity) —
// presumably pasted from a rich-text editor — which then renders as an
// invisible/inconsistent gap rather than a real space (generalized text
// normalization work package, 2026-09-07).
const NBSP_CHAR_RE = /[  ]/g;
// Zero-width formatting characters that can leak in from a rich-text source
// with no visible trace at all (zero-width space/joiner/non-joiner, BOM).
const ZERO_WIDTH_RE = /[​-‍﻿]/g;

/**
 * The one generalized, safe plain-text normalizer for adapter-extracted
 * text (generalized event description/text normalization work package,
 * 2026-09-07). Deliberately conservative: every transformation here is
 * either (a) making already-decoded/whitespace-correct text idempotent
 * under a second pass, or (b) fixing an unambiguous encoding/formatting
 * artifact — HTML entities, stray tags, non-breaking/zero-width characters,
 * CRLF line endings, repeated whitespace, Unicode composition. It NEVER
 * rewrites words: no spelling/grammar changes, no apostrophe substitution,
 * no capitalization changes, no removal of ordinary punctuation. A
 * source-authored token like "14'e" passes through completely unchanged —
 * there is no entity or tag anywhere inside it for this function to touch.
 *
 * `singleLine` (title/artist/venue-name-shaped fields): every line break
 * collapses to a space, matching how those fields are actually displayed.
 * Default (description/relevanceText-shaped fields): line breaks are
 * meaningful paragraph/list separators and are kept, but a run of blank
 * lines collapses away entirely — the same behavior htmlToText already had
 * before this function existed, now shared rather than duplicated.
 *
 * Idempotent by construction — safe to call more than once on the same
 * string (e.g. once inside an adapter's own htmlToText call, once more at
 * the shared pipeline choke point) without further altering already-clean
 * text. This is deliberate: rather than trying to have some adapters "opt
 * out" of the shared pipeline pass, every adapter's extracted text always
 * goes through it, and a second harmless pass is the price of one universal
 * integration point instead of per-source conditional logic.
 */
export function normalizeExtractedText(text: string, options: { singleLine?: boolean } = {}): string {
  if (!text) return text;
  let out = text
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Matches a bare <br>/<br/> as well as an attributed variant like
    // <br class="html-br" /> (real evidence: a Pumpehuset lineup list used
    // exactly this to separate names — without this, "Leeni & Danilo
    // Kupfernagel", "Lush" and "NILU" would silently concatenate into one
    // run-on string with no separator at all).
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  out = decodeHtmlEntities(out);
  out = out.normalize("NFC");
  out = out
    .replace(/\u2029/g, "\n\n") // Unicode paragraph separator -> blank line
    .replace(/\u2028/g, "\n") // Unicode line separator -> line break
    .replace(/\r\n?/g, "\n") // CRLF/CR -> LF
    .replace(ZERO_WIDTH_RE, "")
    .replace(NBSP_CHAR_RE, " ");

  if (options.singleLine) {
    return out.replace(/\s+/g, " ").trim();
  }
  return out
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .trim();
}

/** Renders an HTML fragment to plain text the way a browser would display it. */
export function htmlToText(html: string): string {
  return normalizeExtractedText(html);
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

/**
 * Truncates text to at most `maxLength` characters without cutting off
 * mid-word or mid-sentence when a clean boundary exists near the limit —
 * originally built for Hangaren (real evidence: bios routinely got cut to a
 * bare `.slice(0, 600)`, landing mid-word, e.g. "...She al", "...no dou",
 * "...Today, "). Prefers the last sentence-ending punctuation within the
 * limit; falls back to the last word boundary; only cuts mid-word as a last
 * resort. Reused by any adapter that hard-truncates a long description
 * (pre-launch QA audit, 2026-08-29, found the same bare-slice mid-word cut
 * on ALICE, Gravity, and Poolen).
 */
export function truncateAtBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastSentenceEnd > maxLength * 0.5) return slice.slice(0, lastSentenceEnd + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

// A short, curated set of call-to-action phrases/glyphs that legitimately
// belong to card "read more" buttons, never to an event's actual name — if
// one of these appears anywhere in an extracted title, everything from it
// onward is description/navigation copy that leaked in, not the title.
const TITLE_CTA_MARKER =
  /\b(view event|read more|learn more|buy tickets?|get tickets?|more info(?:rmation)?|find out more|see (?:more|details)|click here)\b|[→»›]|->/i;

/**
 * Public event-integrity audit (2026-09-04): a title-extraction regex that
 * only bounds itself on nested HTML tags (e.g. Hangaren's `[^<]*` capture —
 * see hangarenAdapter.ts) has no defense against a future template change
 * that concatenates plain description/CTA text into the same element with
 * no tag boundary between them. No such contamination was found in any
 * currently-published event (see event-integrity diagnostic mode's full
 * audit — 0 of 114), but the failure mode this guards is real given how
 * these regexes are shaped, so it's closed at the single shared point every
 * source's title passes through on its way to canonical storage
 * (runIngestionPipeline) rather than adapter-by-adapter. Two independent,
 * source-agnostic passes: strip anything from a recognizable CTA marker
 * onward, then hard-cap length at a boundary well above any real observed
 * title (the longest currently-published title is 124 chars) so a title
 * with no CTA marker but still-runaway length can't reach storage either.
 */
export function sanitizeExtractedTitle(title: string, maxLength = 200): string {
  // Text normalization (generalized event description/text normalization
  // work package, 2026-09-07) runs first — entity-decoded, tag-stripped,
  // nbsp/zero-width-clean, single-line — so every title reaching this
  // function's own CTA-stripping/length-cap logic is already clean,
  // regardless of whether the source adapter itself decoded anything.
  const normalized = normalizeExtractedText(title, { singleLine: true });
  const ctaMatch = TITLE_CTA_MARKER.exec(normalized);
  if (!ctaMatch) return truncateAtBoundary(normalized, maxLength);
  // Only the CTA-stripped boundary gets its trailing separator cleaned up —
  // an ordinary title with no CTA match is never touched by this trim, so a
  // legitimate title that itself ends in punctuation (e.g. an abbreviation)
  // can't be altered by this pass.
  const withoutCta = normalized.slice(0, ctaMatch.index).replace(/[\s:;,.–—-]+$/, "").trim();
  return truncateAtBoundary(withoutCta || normalized, maxLength);
}

// Product decision (editorial-description follow-up, Pumpehuset): a
// Danish-only description is not shown publicly rather than displaying
// non-English prose, since Electronic CPH is English-language with no
// runtime translation. Narrow, deterministic signal, deliberately not real
// language detection: the Danish alphabet's three extra letters essentially
// never occur in English prose but occur routinely in real Danish sentences
// of any length. A description that happens to avoid them entirely (e.g. a
// short English quote) is treated as eligible to show — the narrowest
// reliable rule, not a robust classifier. Reused by any adapter with the
// same risk (pre-launch QA audit, 2026-08-29, found Poolen had no such
// guard despite the same Danish-source-text risk as Pumpehuset).
const DANISH_LETTERS = /[æøåÆØÅ]/;

export function isLikelyDanish(text: string): boolean {
  return DANISH_LETTERS.test(text);
}
