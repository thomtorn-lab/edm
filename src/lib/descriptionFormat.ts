import { decodeHtmlEntities } from "./adapters/htmlExtraction";
import { BARE_LABEL_RE } from "./aboutContent";

/**
 * Presentation-only structuring of an event's About description (About-text
 * formatting work package, 2026-10-15).
 *
 * Stored descriptions are always left exactly as the source/admin supplied
 * them — this module never writes anything back. It turns that stored text
 * into a small, typed block list (headings, paragraphs, safe links) which
 * src/components/EventDescription.tsx renders with plain React elements, so
 * no source-supplied markup is ever injected into the page.
 *
 * Every rule here only adds structure that is already evident in the source
 * text (blank lines, standalone short lines, an artist-marker convention the
 * description itself repeats, a well-known section title). Words are never
 * rewritten, reordered, added or removed — the one thing that changes on
 * screen is that a recognised URL is shown as a short link label (the
 * destination is the original URL, untouched). When a rule is not sure, the
 * line is left as an ordinary line.
 */

export type DescriptionInline =
  | { type: "text"; text: string }
  | { type: "link"; href: string; label: string };

export type DescriptionBlock =
  /**
   * `section`: a section title ("Lineup", "PRACTICAL INFORMATION", a source
   * <h2>). `entry`: a heading inside a section — an artist name/bio heading
   * ("☆ BK [he/him]", "PINK MONKEY: DJ").
   */
  | { type: "heading"; level: "section" | "entry"; content: DescriptionInline[] }
  /** One visual paragraph; each entry is one line (rendered with a line break between them). */
  | { type: "paragraph"; lines: DescriptionInline[][] };

export type FormatDescriptionOptions = {
  /**
   * Exact strings (artist names, the event title) that may be promoted to a
   * heading when one sits alone on its own line directly above body text.
   */
  headingHints?: readonly string[];
};

// Line prefix the HTML conversion uses to mark a source <h1>-<h6>. A control
// character can never appear in normalized text, so it cannot collide with
// real content.
const HEADING_MARK = "\u0001";

const HTML_TAG_RE = /<\/?(?:p|br|div|li|ul|ol|h[1-6]|strong|em|b|i|u|a|span|section|article|blockquote)\b[^>]*>/i;

/**
 * Converts stored HTML (should a description ever arrive as markup — e.g.
 * pasted by an admin) to the same plain-text shape the rest of this module
 * understands. Tags are never passed through; anchors keep their visible
 * text and, when that text isn't already the URL, the URL itself so it can
 * still be linked.
 */
function htmlToPlain(html: string): string {
  let out = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_, _q, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      const url = decodeHtmlEntities(href).trim();
      if (!/^https?:\/\//i.test(url)) return text;
      if (!text || text.includes(url) || url.includes(text)) return url;
      return `${text} ${url}`;
    })
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, inner: string) => `\n\n${HEADING_MARK}${inner.replace(/\s+/g, " ")}\n\n`)
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(?:p|div|ul|ol|section|article|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  out = decodeHtmlEntities(out);
  return out;
}

// Unicode "mathematical" bold letters and digits (serif bold, bold italic,
// sans-serif bold, sans-serif bold italic, bold digits) \u2014 the styled text
// Instagram captions use for section titles ("\uD835\uDDDF\uD835\uDDF6\uD835\uDDFB\uD835\uDDF2\uD835\uDE02\uD835\uDDFD", "\uD835\uDDD4\uD835\uDDF1\uD835\uDDFA\uD835\uDDF6\uD835\uDE00\uD835\uDE00\uD835\uDDF6\uD835\uDDFC\uD835\uDDFB"). Italic
// alone is emphasis, not a heading, so it is deliberately not included.
const STYLED_BOLD = "\\u{1D400}-\\u{1D433}\\u{1D468}-\\u{1D49B}\\u{1D5D4}-\\u{1D607}\\u{1D63C}-\\u{1D66F}\\u{1D7CE}-\\u{1D7D7}\\u{1D7EC}-\\u{1D7F5}";
// A styled-bold run at the start of a line: at least three bold characters,
// with only spaces and light punctuation between them; then the rest.
const STYLED_HEAD_RE = new RegExp(`^((?:[${STYLED_BOLD}][\\s'\u2019:&/+.,!()\\-\u2013\u2014]*){3,})([\\s\\S]*)$`, "u");
// A line that is nothing but a separator ("\u2014\u2014\u2014\u2014", "-----").
const SEPARATOR_LINE_RE = /^(?:[\u2014\u2013]{3,}|-{4,}|_{4,}|={4,})$/;
const SEPARATOR_RUN_RE = /(?:[\u2014\u2013]{3,}|-{4,}|_{4,}|={4,})/g;

/** Styled Unicode letters/digits shown as the plain characters they stand for. */
function plainStyled(text: string): string {
  return text.replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => c.normalize("NFKC"));
}

/**
 * Splits a styled-bold section title off the start of a line
 * ("\uD835\uDDDF\uD835\uDDF6\uD835\uDDFB\uD835\uDDF2\uD835\uDE02\uD835\uDDFD Beste Hira \u2026" \u2192 "Lineup" + "Beste Hira \u2026"). Null unless the run
 * reads as a title: short, not a sentence, and ending on a word boundary.
 */
function splitStyledHeading(line: string): { heading: string; rest: string } | null {
  const m = line.match(STYLED_HEAD_RE);
  if (!m) return null;
  const [, run, rest] = m;
  if (rest && !/[\s:\u2013\u2014\-]$/.test(run)) return null;
  const heading = plainStyled(run).replace(/[\s:\u2013\u2014\-]+$/, "").trim();
  if (!heading || heading.length > 80 || wordCount(heading) > 10 || /[.!?]$/.test(heading)) return null;
  return { heading, rest: rest.trim() };
}

/**
 * A description stored as one long line (its line breaks lost before it
 * reached us \u2014 real case: an admin-created Den Anden Side listing) keeps
 * its old paragraph breaks only as runs of two or more spaces. Those alone
 * are never trusted (some writers put two spaces after every sentence):
 * the text must also mark its sections itself \u2014 separator runs ("\u2014\u2014\u2014\u2014") or
 * styled-bold section titles at those boundaries, at least two such marks.
 * Then each run becomes a paragraph break again; otherwise the text is
 * returned unchanged.
 */
function recoverFlatStructure(text: string): string {
  if (text.includes("\n") || text.length < 600) return text;
  const gaps = (text.match(/ {2,}/g) ?? []).length;
  if (gaps < 3) return text;
  const separators = (text.match(SEPARATOR_RUN_RE) ?? []).length;
  const segments = text.split(/ {2,}/).flatMap((s) => s.split(SEPARATOR_RUN_RE)).map((s) => s.trim());
  const styledHeads = segments.filter((s) => splitStyledHeading(s) !== null).length;
  if (separators + styledHeads < 2 || styledHeads < 1) return text;
  return text.replace(/ *((?:[\u2014\u2013]{3,}|-{4,}|_{4,}|={4,})) */g, "\n\n$1\n\n").replace(/ {2,}/g, "\n\n");
}

function normalize(text: string): string {
  const plain = HTML_TAG_RE.test(text) ? htmlToPlain(text) : text;
  const unified = plain
    .replace(/\r\n?/g, "\n")
    .replace(/\u2029/g, "\n\n")
    .replace(/\u2028/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\u202F]/g, " ");
  return recoverFlatStructure(unified.trim())
    .split("\n")
    // Paired Markdown bold markers ("**PLEASE READ**") are markup, not
    // content: the markers go, the words stay. An unpaired "*" is kept.
    .map((l) => l.replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "$1"))
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------- headings

// Star/diamond glyphs that descriptions use to open an artist section
// ("☆ BK [he/him]"). Deliberately excludes list bullets (•, -, *), which
// mark list items rather than sections.
const ARTIST_MARKERS = "☆★✦✧✩✪✫✬✭✮✯✰⭐❖◆◇";
const ARTIST_MARKER_CLASS = `[${ARTIST_MARKERS}]`;
const STARTS_WITH_MARKER_RE = new RegExp(`^${ARTIST_MARKER_CLASS}`, "u");

const PRONOUN = "(?:she|he|they|them|her|him|his|hers|theirs|xe|xem|ze|zir|it|its|any|all)";
const PRONOUN_BRACKET = `[\\[(]\\s*${PRONOUN}(?:\\s*\\/\\s*${PRONOUN})+\\s*[\\])]`;
const ENDS_WITH_PRONOUNS_RE = new RegExp(`${PRONOUN_BRACKET}$`, "i");
// "☆ BK [he/him] BK is a DJ…" — marker, a short name, a pronoun bracket, then body.
const MARKER_PRONOUN_HEAD_RE = new RegExp(`^(${ARTIST_MARKER_CLASS}\\s*[^\\n\\[\\]()]{1,60}?\\s*${PRONOUN_BRACKET})\\s+(\\S[\\s\\S]*)$`, "iu");

const ROLE_WORD =
  "(?:DJs?|Live(?:\\s+(?:act|set|PA))?|Artist|Producer|Vocalist|Singer|Composer|Musician|Selector|Hybrid(?:\\s+set)?|B2B|Performer|Visual\\s+artist|VJ|Percussionist|Rapper|MC|Band|Duo|Trio|Collective)";
const ROLE_PHRASE = `${ROLE_WORD}(?:\\s*(?:&|\\+|\\/|,|and|og)\\s*${ROLE_WORD})*`;
// "ARTIST NAME: DJ" / "Artist Name: Artist & Producer" as a whole line.
const NAME_ROLE_LINE_RE = new RegExp(`^[^:]{1,50}:\\s*${ROLE_PHRASE}$`, "i");
// The same convention mid-line, after a sentence end — name must be upper-case.
const NAME_ROLE_INLINE_RE = new RegExp(
  `(?<=[.!?…"”)\\]]\\s{1,3})([A-Z0-9ÆØÅÄÖÜ][A-Z0-9ÆØÅÄÖÜ .&'’\\-]{0,40}[A-Z0-9ÆØÅÄÖÜ]:\\s*${ROLE_PHRASE})(?=\\s)`,
  "gu",
);
// Section labels that, written as a name-role-looking prefix, are not artists.
const SECTION_WORD_RE = /^(?:line-?\s?up|program(?:me)?|who|what|where|when|music|genre|info|time ?table|support)$/i;

const SECTION_TITLES = new Set(
  [
    "lineup",
    "line-up",
    "line up",
    "the lineup",
    "program",
    "programme",
    "program/lineup",
    "timetable",
    "time table",
    "schedule",
    "about",
    "about the event",
    "about the night",
    "about the artist",
    "about the artists",
    "the artists",
    "artists",
    "info",
    "information",
    "practical info",
    "practical information",
    "practicalities",
    "tickets",
    "ticket info",
    "ticket information",
    "prices",
    "code of conduct",
    "house rules",
    "safer space",
    "safer spaces",
    "safe space",
    "safer space policy",
    "awareness",
    "accessibility",
    "access",
    "faq",
    "venue",
    "location",
    "doors",
    "age limit",
    "music",
    "sound",
    "praktisk information",
    "praktisk info",
    "praktiske oplysninger",
    "billetter",
    "om eventet",
    "om arrangementet",
    "om kunstneren",
    "om kunstnerne",
    "tilgængelighed",
  ].map((s) => s.toLowerCase()),
);

const TERMINAL_PUNCT_RE = /[.!?,;…]$/;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const HAS_URL_RE = /\b(?:https?:\/\/|www\.)\S/i;

function isUpperCaseLine(line: string): boolean {
  const letters = line.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return false;
  return !/\p{Ll}/u.test(line);
}

function wordCount(line: string): number {
  return line.split(/\s+/).filter(Boolean).length;
}

type LineContext = {
  upperCaseHeadingsAllowed: boolean;
  hints: Set<string>;
  /** How many lines in this description are short labels closed by a dash ("Cold Connection-"). */
  dashLabelCount: number;
};

// A short name/label closed by a dash ("Cold Connection-", "ee:man -") —
// some sources (real case: KultuNaut 20265870, Electro Werkz) open every
// artist section this way. Only trusted when the description repeats it.
const DASH_LABEL_RE = /^[^.!?,;]{2,40}?\s?[-–]$/u;

type HeadingLevel = "section" | "entry";

/** The heading level of a line that stands on its own and reads unambiguously as a heading, else null. */
function headingLevel(line: string, nextLine: string | null, ctx: LineContext): HeadingLevel | null {
  if (line.startsWith(HEADING_MARK)) return "section";
  // A Markdown "## " heading counts only when the line is heading-shaped:
  // one short phrase, not a run of sentences a source happened to prefix.
  if (/^#{1,6}\s+\S/.test(line)) {
    const text = line.replace(/^#{1,6}\s+/, "");
    return text.length <= 80 && !/[.!?]\s+\S/.test(text) && !HAS_URL_RE.test(text) ? "section" : null;
  }
  if (line.length > 80 || HAS_URL_RE.test(line)) return null;
  const bare = line.replace(/:$/, "").trim();
  if (!bare) return null;

  // "☆ BK [he/him]" / "☆ babysquid" — a marker-led short line over body
  // text (a run of marker-led short lines is a list, not headings).
  if (
    STARTS_WITH_MARKER_RE.test(line) &&
    line.length <= 70 &&
    !TERMINAL_PUNCT_RE.test(line) &&
    nextLine !== null &&
    !STARTS_WITH_MARKER_RE.test(nextLine) &&
    nextLine.length >= 40
  ) {
    return "entry";
  }
  // "BK [he/him]" — a short name closed by a pronoun bracket.
  if (ENDS_WITH_PRONOUNS_RE.test(line) && line.length <= 70) return "entry";
  // "PINK MONKEY: DJ", "Name: Artist & Producer".
  if (NAME_ROLE_LINE_RE.test(line) && !SECTION_WORD_RE.test(line.split(":")[0].trim())) return "entry";
  // "Lineup", "Practical information:", "CODE OF CONDUCT".
  if (SECTION_TITLES.has(bare.toLowerCase())) return "section";
  // "Cold Connection-" over body text, a convention used at least twice here.
  if (ctx.dashLabelCount >= 2 && DASH_LABEL_RE.test(line) && nextLine !== null && nextLine.length >= 40 && !DASH_LABEL_RE.test(nextLine)) {
    return "entry";
  }

  // Everything below needs body text right after it to count as a heading.
  if (!nextLine || nextLine.startsWith(HEADING_MARK)) return null;
  if (TERMINAL_PUNCT_RE.test(line) || /\d/.test(line)) return null;

  // A line that exactly names one of the event's artists (or its title).
  if (ctx.hints.has(bare.toLowerCase()) && nextLine.length >= 40) return "entry";

  // A short all-caps line over normal-case body text. Skipped entirely when
  // the description writes much of itself in capitals (then case carries no
  // structural meaning).
  if (
    ctx.upperCaseHeadingsAllowed &&
    isUpperCaseLine(line) &&
    line.length <= 50 &&
    wordCount(line) <= 7 &&
    !isUpperCaseLine(nextLine) &&
    nextLine.length >= 40
  ) {
    return "section";
  }
  return null;
}

function cleanHeadingText(line: string): string {
  return line.replace(new RegExp(`^${HEADING_MARK}`), "").replace(/^#{1,6}\s+/, "").trim();
}

// ------------------------------------------------------------ inline links

type PlatformLabel = { match: RegExp; label: string; name: string; platformWord: RegExp };

const PLATFORM_LABELS: PlatformLabel[] = [
  { match: /(^|\.)spotify\.com$|^spoti\.fi$/, label: "Listen on Spotify", name: "Spotify", platformWord: /spotify/i },
  { match: /(^|\.)soundcloud\.com$|^snd\.sc$/, label: "Listen on SoundCloud", name: "SoundCloud", platformWord: /soundcloud/i },
  { match: /(^|\.)bandcamp\.com$/, label: "Listen on Bandcamp", name: "Bandcamp", platformWord: /bandcamp/i },
  { match: /(^|\.)mixcloud\.com$/, label: "Listen on Mixcloud", name: "Mixcloud", platformWord: /mixcloud/i },
  { match: /^music\.apple\.com$/, label: "Listen on Apple Music", name: "Apple Music", platformWord: /apple music/i },
  { match: /(^|\.)youtube\.com$|^youtu\.be$/, label: "Watch on YouTube", name: "YouTube", platformWord: /youtube/i },
  { match: /(^|\.)instagram\.com$/, label: "Instagram", name: "Instagram", platformWord: /instagram/i },
  { match: /(^|\.)facebook\.com$|^fb\.me$/, label: "Facebook", name: "Facebook", platformWord: /facebook/i },
  { match: /(^|\.)tiktok\.com$/, label: "TikTok", name: "TikTok", platformWord: /tiktok/i },
  { match: /^ra\.co$|(^|\.)residentadvisor\.net$/, label: "Resident Advisor", name: "Resident Advisor", platformWord: /resident advisor|\bRA\b/i },
];

/** Trims sentence punctuation (and an unbalanced closing bracket) off a matched URL. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.slice(-1);
    if (/[.,;:!?'"»”’]/.test(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ")" && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === "]" && !url.includes("[")) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

function compactUrlLabel(url: URL): string {
  const host = url.hostname.replace(/^www\./, "");
  const path = decodeURIComponentSafe(url.pathname).replace(/\/+$/, "");
  const label = `${host}${path}`;
  return label.length > 40 ? `${label.slice(0, 39)}…` : label;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** A valid, complete http(s) URL — or null when it can't be linked safely. */
function parseLinkableUrl(raw: string, following: string): URL | null {
  // A URL cut off by the source ("https://soundcloud.com/pinkmo…") is never
  // guessed at or repaired; it stays plain text.
  if (/(?:…|\.\.\.)$/.test(raw) || /^(?:…|\.\.\.)/.test(following)) return null;
  const href = /^www\./i.test(raw) ? `https://${raw}` : raw;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname)) return null;
  return url;
}

function tokenizeInline(line: string): DescriptionInline[] {
  const out: DescriptionInline[] = [];
  let cursor = 0;
  const matches = [...line.matchAll(URL_RE)];
  // Text on this line outside any URL — used to avoid "SoundCloud: Listen on SoundCloud".
  const surrounding = line.replace(URL_RE, " ");
  for (const m of matches) {
    const start = m.index ?? 0;
    const raw = trimUrl(m[0]);
    const end = start + raw.length;
    const url = parseLinkableUrl(raw, line.slice(end));
    if (!url) continue;
    if (start > cursor) out.push({ type: "text", text: line.slice(cursor, start) });
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const platform = PLATFORM_LABELS.find((p) => p.match.test(host));
    // "SoundCloud: <url>" → keep the line's own wording, don't repeat the
    // platform; "Listen here: <url>" → name the platform, not "Listen" twice.
    const label = !platform
      ? compactUrlLabel(url)
      : platform.platformWord.test(surrounding)
        ? compactUrlLabel(url)
        : /\b(?:listen|watch|lyt|se)\b/i.test(surrounding)
          ? platform.name
          : platform.label;
    out.push({ type: "link", href: url.href, label });
    cursor = end;
  }
  if (cursor < line.length) out.push({ type: "text", text: line.slice(cursor) });
  return mergeText(out);
}

function mergeText(tokens: DescriptionInline[]): DescriptionInline[] {
  const out: DescriptionInline[] = [];
  for (const t of tokens) {
    const prev = out[out.length - 1];
    if (t.type === "text" && prev?.type === "text") prev.text += t.text;
    else if (t.type !== "text" || t.text) out.push({ ...t });
  }
  return out;
}

// ---------------------------------------------------------- section splits

/**
 * Splits lines that run several artist sections together ("…end of bio.
 * ☆ DJ paulC [he/him] paulC is…") at each section start. Only done for a
 * convention the description itself establishes: a marker glyph used at
 * least twice, or an upper-case "NAME: role" prefix used at least twice.
 * A single, isolated mention is never treated as a section boundary.
 */
function splitMergedSections(lines: string[], fullText: string): string[] {
  const markerCounts = new Map<string, number>();
  for (const ch of fullText.matchAll(new RegExp(ARTIST_MARKER_CLASS, "gu"))) {
    markerCounts.set(ch[0], (markerCounts.get(ch[0]) ?? 0) + 1);
  }
  const repeatedMarkers = [...markerCounts.entries()].filter(([, n]) => n >= 2).map(([m]) => m);
  const nameRoleMatches = [...fullText.matchAll(NAME_ROLE_INLINE_RE)].filter(
    (m) => !SECTION_WORD_RE.test(m[1].split(":")[0].trim()),
  );
  const splitNameRole = nameRoleMatches.length + countLineStartNameRoles(lines) >= 2;

  const out: string[] = [];
  for (const line of lines) {
    let pieces = [line];
    if (repeatedMarkers.length > 0) {
      const re = new RegExp(`\\s+(?=[${repeatedMarkers.join("")}]\\s*\\S)`, "gu");
      pieces = pieces.flatMap((p) => p.split(re));
    }
    if (splitNameRole) {
      pieces = pieces.flatMap((p) => {
        const parts: string[] = [];
        let last = 0;
        for (const m of p.matchAll(NAME_ROLE_INLINE_RE)) {
          if (SECTION_WORD_RE.test(m[1].split(":")[0].trim())) continue;
          const idx = m.index ?? 0;
          if (idx > last) parts.push(p.slice(last, idx).trim());
          last = idx;
        }
        parts.push(p.slice(last).trim());
        return parts.filter(Boolean);
      });
    }
    // Separate a section head from the body that follows it on the same line.
    for (const piece of pieces) {
      const markerHead = piece.match(MARKER_PRONOUN_HEAD_RE);
      if (markerHead) {
        out.push(markerHead[1].trim(), markerHead[2].trim());
        continue;
      }
      if (splitNameRole) {
        const nameRole = piece.match(new RegExp(`^([A-Z0-9ÆØÅÄÖÜ][A-Z0-9ÆØÅÄÖÜ .&'’\\-]{0,40}[A-Z0-9ÆØÅÄÖÜ]:\\s*${ROLE_PHRASE})\\s+(\\S[\\s\\S]*)$`, "u"));
        if (nameRole && !SECTION_WORD_RE.test(nameRole[1].split(":")[0].trim()) && wordCount(nameRole[2]) >= 4) {
          out.push(nameRole[1].trim(), nameRole[2].trim());
          continue;
        }
      }
      out.push(piece);
    }
  }
  return out;
}

function countLineStartNameRoles(lines: string[]): number {
  const re = new RegExp(`^[A-Z0-9ÆØÅÄÖÜ][A-Z0-9ÆØÅÄÖÜ .&'’\\-]{0,40}[A-Z0-9ÆØÅÄÖÜ]:\\s*${ROLE_PHRASE}(?:\\s|$)`, "u");
  return lines.filter((l) => re.test(l) && !SECTION_WORD_RE.test(l.split(":")[0].trim())).length;
}

// ------------------------------------------------------------- paragraphs

/** True when `next` merely continues `prev` (a hard-wrapped sentence), so the break is not meaningful. */
function isSoftWrap(prev: string, next: string): boolean {
  if (prev.length < 40) return false;
  if (/[.!?:;…"”)\]]$/.test(prev)) return false;
  if (/\p{Extended_Pictographic}$/u.test(prev)) return false;
  return /^\p{Ll}/u.test(next);
}

const LONG_LINE = 80;

/**
 * Turns one run of consecutive non-heading lines into paragraphs: soft-wrapped
 * lines rejoin, consecutive full-length prose lines each become their own
 * paragraph (sources that use a single line break per paragraph), and short
 * lines (dates, prices, calls to action) stay together as separate lines.
 */
function linesToParagraphs(lines: string[]): string[][] {
  const joined: string[] = [];
  for (const line of lines) {
    const prev = joined[joined.length - 1];
    if (prev !== undefined && isSoftWrap(prev, line)) joined[joined.length - 1] = `${prev} ${line}`;
    else joined.push(line);
  }
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of joined) {
    const prev = current[current.length - 1];
    if (prev !== undefined && (prev.length >= LONG_LINE || line.length >= LONG_LINE)) {
      paragraphs.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

// ------------------------------------------------------------------ public

/**
 * Deterministic tidying that can't lose information (2026-10-25):
 * - label lines with no value left at the very end ("Entré", "Praktisk
 *   info:." — KultuNaut keeps the price itself elsewhere on the page) are
 *   dropped; a label followed by content (a real "Practical information"
 *   heading) is kept;
 * - a paragraph repeated word for word (whitespace/case aside, at least 40
 *   characters) is shown once.
 */
function tidyBlocks(blocks: string[][]): string[][] {
  const out = blocks.map((b) => [...b]);
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.length > 0 && BARE_LABEL_RE.test(last[last.length - 1])) last.pop();
    else if (last.length === 0) out.pop();
    else break;
  }
  const seen = new Set<string>();
  return out.filter((block) => {
    const key = block.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
    if (key.length < 40) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatDescription(text: string | null | undefined, options: FormatDescriptionOptions = {}): DescriptionBlock[] {
  if (!text) return [];
  const normalized = normalize(text);
  if (!normalized) return [];

  // A styled-bold title at the start of a line becomes a section heading
  // (shown in plain letters); any text after it on that line stays as body.
  const rawBlocks = tidyBlocks(normalized.split(/\n\n/).map((b) => b.split("\n").filter(Boolean))).map((lines) =>
    lines.flatMap((line) => {
      const styled = splitStyledHeading(line);
      return styled ? [`${HEADING_MARK}${styled.heading}`, ...(styled.rest ? [styled.rest] : [])] : [line];
    }),
  );
  const allLines = rawBlocks.flat();
  const upperCount = allLines.filter(isUpperCaseLine).length;
  const ctx: LineContext = {
    upperCaseHeadingsAllowed: allLines.length > 0 && upperCount / allLines.length < 0.4,
    hints: new Set((options.headingHints ?? []).map((h) => h.trim().toLowerCase()).filter((h) => h.length >= 2)),
    dashLabelCount: allLines.filter((l) => DASH_LABEL_RE.test(l)).length,
  };

  const splitBlocks = rawBlocks.map((b) => splitMergedSections(b, normalized));
  const blocks: DescriptionBlock[] = [];
  splitBlocks.forEach((lines, blockIndex) => {
    let pending: string[] = [];
    const flush = () => {
      for (const para of linesToParagraphs(pending)) {
        blocks.push({ type: "paragraph", lines: para.map(tokenizeInline) });
      }
      pending = [];
    };
    lines.forEach((line, i) => {
      // Body text may follow a heading on the next line or after a blank line.
      const next = lines[i + 1] ?? splitBlocks[blockIndex + 1]?.[0] ?? null;
      const level = headingLevel(line, next, ctx);
      if (level) {
        flush();
        blocks.push({ type: "heading", level, content: tokenizeInline(cleanHeadingText(line)) });
      } else {
        // A Markdown heading marker on a line that isn't a heading is markup,
        // not content — dropped like an HTML tag, the words are kept.
        pending.push(line.replace(/^#{1,6}\s+(?=\S)/, ""));
      }
    });
    flush();
  });
  // A heading with nothing after it is not a heading of anything.
  const last = blocks[blocks.length - 1];
  if (last?.type === "heading") blocks[blocks.length - 1] = { type: "paragraph", lines: [last.content] };
  return blocks;
}

/** Plain-text rendering of the formatted blocks — for ICS/calendar text and tests. */
export function formattedDescriptionToText(blocks: DescriptionBlock[]): string {
  const inline = (tokens: DescriptionInline[]) => tokens.map((t) => (t.type === "text" ? t.text : t.href)).join("");
  return blocks
    .map((b) => (b.type === "heading" ? inline(b.content) : b.lines.map(inline).join("\n")))
    .join("\n\n");
}

function blockTextLength(block: DescriptionBlock): number {
  const inline = (tokens: DescriptionInline[]) => tokens.reduce((n, t) => n + (t.type === "text" ? t.text.length : t.label.length), 0);
  return block.type === "heading" ? inline(block.content) : block.lines.reduce((n, l) => n + inline(l), 0);
}

/** Descriptions up to this many characters are always shown in full. */
export const PREVIEW_MIN_TOTAL = 900;
const PREVIEW_TARGET = 500;
const PREVIEW_MIN_REST = 250;

/**
 * Where a long About text is folded behind "Show more" (2026-10-24): the
 * number of leading blocks shown up front, or null to show everything. Only
 * ever splits between whole blocks (never mid-paragraph), never leaves a
 * heading as the last visible block, and never folds away a small tail —
 * short descriptions are always shown in full. Presentation only: every
 * block is still rendered into the page's HTML.
 */
export function previewBlockCount(blocks: DescriptionBlock[]): number | null {
  const lengths = blocks.map(blockTextLength);
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= PREVIEW_MIN_TOTAL) return null;
  let shown = 0;
  let count = 0;
  while (count < blocks.length && shown < PREVIEW_TARGET) shown += lengths[count++];
  while (count > 1 && blocks[count - 1].type === "heading") shown -= lengths[--count];
  if (count === 0 || count >= blocks.length) return null;
  return total - shown >= PREVIEW_MIN_REST ? count : null;
}

// ------------------------------------------------------ practical sections

// Section titles that only ever head practical venue information.
const PRACTICAL_HEADING_RE =
  /^(?:admission|entry|entrance|tickets?|ticket info(?:rmation)?|billetter|entr[ée]e?|prices?|priser|age(?: limit)?|aldersgrænse|wardrobe|garderobe|cloakroom|door ?policy|dørpolitik|code of conduct|house rules|vibe vision|awareness|safer? spaces?(?: policy)?|accessibility|tilgængelighed|practical info(?:rmation)?|praktisk info(?:rmation)?|praktiske oplysninger)$/i;
const EXPLICIT_PRACTICAL_RE = /^(?:practical info(?:rmation)?|praktisk info(?:rmation)?|praktiske oplysninger)$/i;
const ABOUT_MIN_CHARS = 200;

function inlineText(tokens: DescriptionInline[]): string {
  return tokens.map((t) => (t.type === "text" ? t.text : t.label)).join("");
}

function isPracticalHeading(block: DescriptionBlock): boolean {
  return block.type === "heading" && PRACTICAL_HEADING_RE.test(inlineText(block.content).replace(/[\s:.\-–—]+$/, "").trim());
}

/** The source's own "Practical information" title, if that is how the block reads. */
export function explicitPracticalTitle(block: DescriptionBlock | undefined): string | null {
  if (block?.type !== "heading") return null;
  const text = inlineText(block.content).replace(/[\s:]+$/, "").trim();
  return EXPLICIT_PRACTICAL_RE.test(text) ? text : null;
}

function isSeparator(block: DescriptionBlock | undefined): boolean {
  return block?.type === "paragraph" && block.lines.length === 1 && SEPARATOR_LINE_RE.test(inlineText(block.lines[0]).trim());
}

/**
 * Where a description's trailing practical section starts (2026-10-30), or
 * null to keep it as one About text. Only when the source itself marks it:
 * from the first practical section title (Admission, Age, Wardrobe, Door
 * policy, Code of conduct, Awareness, Practical information…) to the end,
 * every heading is practical, there are at least two of them (or one
 * explicit "Practical information"), and a real About text (lineup
 * included) comes before. Separator lines just before it go with it.
 * Nothing is dropped: the caller shows both parts.
 */
export function practicalTailStart(blocks: DescriptionBlock[]): number | null {
  const first = blocks.findIndex(isPracticalHeading);
  if (first <= 0) return null;
  const tail = blocks.slice(first);
  if (tail.some((b) => b.type === "heading" && !isPracticalHeading(b))) return null;
  const practicalHeadings = tail.filter(isPracticalHeading);
  const explicit = explicitPracticalTitle(blocks[first]) !== null;
  if (practicalHeadings.length < 2 && !explicit) return null;
  let start = first;
  while (start > 0 && isSeparator(blocks[start - 1])) start--;
  const aboutChars = blocks.slice(0, start).filter((b) => b.type === "paragraph").reduce((n, b) => n + blockTextLength(b), 0);
  return aboutChars >= ABOUT_MIN_CHARS ? start : null;
}

/**
 * A long About text that is one single paragraph can't be folded between
 * paragraphs. Folds it inside the paragraph instead, at the end of a
 * sentence about PREVIEW_TARGET characters in (2026-10-30). Null when the
 * block isn't one long single-line paragraph or no clean sentence end is
 * found. The paragraph itself stays one paragraph.
 */
export function splitLongParagraph(block: DescriptionBlock): { preview: DescriptionInline[]; rest: DescriptionInline[] } | null {
  if (block.type !== "paragraph" || block.lines.length !== 1) return null;
  const tokens = block.lines[0];
  const total = blockTextLength(block);
  if (total <= PREVIEW_MIN_TOTAL) return null;
  let offset = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const len = t.type === "text" ? t.text.length : t.label.length;
    if (t.type === "text") {
      const re = /[.!?…]["”’)]?(?=\s+["“(]?\p{Lu})/gu;
      for (const m of t.text.matchAll(re)) {
        const at = offset + (m.index ?? 0) + m[0].length;
        if (at < 400) continue;
        if (at > 750 || total - at < PREVIEW_MIN_REST) return null;
        const cut = (m.index ?? 0) + m[0].length;
        return {
          preview: [...tokens.slice(0, i), { type: "text", text: t.text.slice(0, cut) }],
          rest: [{ type: "text", text: t.text.slice(cut) }, ...tokens.slice(i + 1)],
        };
      }
    }
    offset += len;
    if (offset > 750) return null;
  }
  return null;
}
