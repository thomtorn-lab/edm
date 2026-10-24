import { decodeHtmlEntities } from "./htmlExtraction";
import { isGenrePhraseOnly, isNameWithGenreKeyword } from "./deterministicGenreMapping";

/**
 * Lineup names of one Culture Box room paragraph (2026-10-14): every linked
 * name, plus the venue's unlinked names when they are unambiguous.
 *
 * Culture Box links most artists, but not all (16 Oct SHK and GEORGEOUS,
 * 30 Oct AB+, 31 Dec "ARTO B2B <a>MAX FINNEY</a>"). Reading only anchors
 * dropped those names. The paragraph's plain text also holds showcase and
 * collective titles, label notes, connectors and alias constructions, so
 * plain text is read conservatively: a token the rules can't vouch for is
 * left out. Missing a name is better than inventing an artist.
 *
 * Rules, per <br>-separated line, in document order:
 *   - Linked names (anchor text) are always kept, exactly as before.
 *   - <strong>…</strong> is a showcase title (even across lines): never a name.
 *   - A first line with no link that ends in ":" is a showcase/collective
 *     ("TECH THE NIGHT:", "ELEVATE PRESENTS BASS RAVE:").
 *   - A line whose plain text has "[", "]" or "aka" is a group/alias
 *     construction ("HALVMÅNE [AMITTET+TINKI]", "MAGHONI & MESSING aka"):
 *     only its links are kept.
 *   - "(…)" is a label/annotation ("(BAD DEAL RECORDS)") and is dropped.
 *   - A connector (B2B, &, x/X, vs) at the edge of a text segment must have
 *     a link on that side ("ARTO B2B <a>MAX FINNEY</a>"), otherwise the
 *     segment is ambiguous ("MALCOLM X" could be one name) and is dropped.
 *   - Between two unlinked tokens only B2B/vs split ("D-TRICH B2B KAREN").
 *     "&" or "x" there may be one duo/collab act or two artists, so the
 *     segment is dropped.
 *   - A plain token is accepted only if it is written in capitals like the
 *     venue's names, has a letter, is at most 30 characters and 3 words, and
 *     has no ":", ",", ";" or "/". It is not an announcement: none of the
 *     words TBA, GUESTS, LINEUP, DOORS…, not a whole announcement phrase
 *     ("ALL NIGHT LONG", "SOLD OUT"), and not ending in LIVE/SET/NIGHT/PARTY.
 *     Words such as NIGHT or OPEN alone don't disqualify a name
 *     ("NIGHT SHIFT").
 *   - Genre words: a token made only of genre keywords ("TECHNO", "HARD
 *     TECHNO") is never a name. A name that contains one ("PAB DISCO") is
 *     kept in a lineup slot, where the pipeline masks it from genre matching
 *     exactly like the same linked name (RawCandidateEvent.lineupNamesAreStructured).
 *     On the room's first line, where an unmarked showcase would sit
 *     ("TECHNO TUESDAY"), it is left out.
 */

const CONNECTOR = String.raw`(?:B2B|&|x|X|vs\.?|VS\.?)`;
const CONNECTOR_SPLIT = new RegExp(String.raw`\s+${CONNECTOR}\s+`);
const AMBIGUOUS_JOIN = /\s(?:&|x|X)\s/;
const LEADING_CONNECTOR = new RegExp(String.raw`^${CONNECTOR}(?:\s+|$)`);
const TRAILING_CONNECTOR = new RegExp(String.raw`(?:^|\s+)${CONNECTOR}$`);

/** Words that never occur in an artist name here: announcement/prose text, or a join ("AND", "WITH") that may hide two acts. */
const NON_ARTIST_WORDS = new Set([
  "TBA", "TBC", "TBD", "GUEST", "GUESTS", "LINEUP", "LINE-UP", "DOORS", "TICKETS", "PRESENTS",
  "HOSTED", "BY", "FEAT", "FEAT.", "FT", "FT.", "AND", "WITH", "PLUS", "SUPPORT", "AKA",
]);
/** Whole-token announcement phrases made of words that do occur in real names. */
const NON_ARTIST_PHRASES = new Set(["MORE", "ALL NIGHT LONG", "SOLD OUT", "FREE ENTRY", "OPEN AIR", "SPECIAL"]);
/** A trailing word that makes the token a performance format or a party ("ARTO LIVE", "TECHNO NIGHT"). */
const NON_ARTIST_LAST_WORDS = new Set(["LIVE", "SET", "SETS", "NIGHT", "PARTY"]);

const textOf = (html: string) => decodeHtmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function isAcceptablePlainName(token: string, { firstLine = false }: { firstLine?: boolean } = {}): boolean {
  if (!token || token.length > 30) return false;
  if (!/\p{L}/u.test(token)) return false;
  if (token !== token.toUpperCase()) return false;
  if (/[:,;/]/.test(token)) return false;
  const words = token.split(" ");
  if (words.length > 3) return false;
  if (words.some((w) => NON_ARTIST_WORDS.has(w))) return false;
  if (NON_ARTIST_PHRASES.has(token) || NON_ARTIST_LAST_WORDS.has(words[words.length - 1])) return false;
  if (isGenrePhraseOnly(token)) return false;
  if (firstLine && isNameWithGenreKeyword(token)) return false;
  return true;
}

/** Plain names in one text segment between links; [] when anything about it is doubtful. */
function plainNames(segment: string, linkBefore: boolean, linkAfter: boolean, firstLine: boolean): string[] {
  let text = segment.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return [];
  if (LEADING_CONNECTOR.test(text)) {
    if (!linkBefore) return [];
    text = text.replace(LEADING_CONNECTOR, "").trim();
  }
  if (TRAILING_CONNECTOR.test(text)) {
    if (!linkAfter) return [];
    text = text.replace(TRAILING_CONNECTOR, "").trim();
  }
  if (!text) return [];
  // "&" / "x" between two unlinked tokens may be one duo/collab act ("BONGO
  // & PUSK") or two artists; the venue links duos as one name. Ambiguous, so
  // left out. Only B2B/vs mean two separate acts.
  if (AMBIGUOUS_JOIN.test(text)) return [];
  const tokens = text.split(CONNECTOR_SPLIT).map((t) => t.trim());
  // All or nothing: one doubtful token makes the whole segment doubtful.
  return tokens.every((t) => isAcceptablePlainName(t, { firstLine })) ? tokens : [];
}

export function extractLineupNames(pHtml: string): string[] {
  const withoutShowcase = pHtml.replace(/<strong>[\s\S]*?<\/strong>/gi, "<br />");
  const lines = withoutShowcase.split(/<br\s*\/?>/i).filter((line) => textOf(line) !== "");
  const names: string[] = [];
  lines.forEach((line, index) => {
    const anchors = [...line.matchAll(/<a\b[^>]*>([^<]*)<\/a>/gi)];
    const segments = line.split(/<a\b[^>]*>[^<]*<\/a>/i);
    const plainText = textOf(segments.join(" "));
    if (index === 0 && anchors.length === 0 && plainText.endsWith(":")) return; // showcase/collective
    const readPlain = !/[[\]]|\baka\b/i.test(plainText);
    segments.forEach((segment, i) => {
      if (readPlain) names.push(...plainNames(textOf(segment), i > 0, i < anchors.length, index === 0));
      if (i < anchors.length) {
        const linked = decodeHtmlEntities(anchors[i][1]).trim();
        if (linked) names.push(linked);
      }
    });
  });
  return names;
}
