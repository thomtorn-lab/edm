import { deterministicGenreFromText, hasExplicitDjOrRaveSignal } from "./adapters/deterministicGenreMapping";

/**
 * Description quality for Discovery Queue rows (coverage work, 2026-10-23).
 * Concert-hall listings on KultuNaut often carry only the venue's practical
 * boilerplate as their "description" — Amager Bio's "Hvis der er udsolgt i
 * forsalg …", handicap seats, Ticketmaster's phone number, "Entré". Storing
 * that as the row's description tells a reviewer nothing, and would show up
 * publicly if the row were published as is.
 *
 * Deliberately conservative: a text counts as practical-only when no
 * sentence says anything about the event beyond the practical vocabulary
 * below (see isInformativeSentence). A single sentence about the music keeps
 * the whole text; a stray genre word inside a practical sentence does not.
 */

/** Word boundaries that also treat æ, ø, å and é as letters (JS's \b does not). */
const B = "(?<![\\p{L}\\d])";
const E = "(?![\\p{L}\\d])";

/** Tickets, doors, seating, access, age, contact, price: the venue's practical info, Danish and English. */
const PRACTICAL_RE = new RegExp(
  [
    "udsolgt",
    "sold ?out",
    "forsalg",
    "dørsalg",
    "døre(?:ne)?\\s+(?:åbne[rs]?|kl)",
    `${B}doors?${E}`,
    "ståplads",
    "siddeplads",
    "handicap",
    "kørestol",
    "wheelchair",
    "ledsager",
    "garderob",
    "ticketmaster",
    "servicecenter",
    "billet",
    `${B}tickets?${E}`,
    `${B}entr[ée]e?${E}`,
    "aldersgrænse",
    `${B}age${E}`,
    `${B}1[68]\\+`,
    "praktisk info",
    "practical info",
    "kontakt",
    "contact",
    "info@",
    "www\\.",
    "https?://",
    `${B}tlf${E}`,
    "telefon",
    `${B}\\d{2} \\d{2} \\d{2} \\d{2}${E}`,
    `${B}kr\\.?${E}`,
    `${B}dkk${E}`,
    `${B}gratis${E}`,
    `${B}free${E}`,
    "donation",
    `${B}vip${E}`,
    "on sale",
    `${B}fees?${E}`,
  ].join("|"),
  "iu",
);

/** Sentence boundaries; a dot after a digit ("1. time", "kl. 20") is not one. */
const SENTENCE_SPLIT_RE = /(?<=[^\d\s][.!?])\s+|\n+/;

/** Filler words that never describe the music, Danish and English. */
const FILLER_WORDS: ReadonlySet<string> = new Set(
  (
    "og i på til fra med for af at er det den der de som en et har hvis vil så være kan skal man du vi os jer hele " +
    "and the a an of to in on at for with is are be will can you we our your all"
  ).split(" "),
);

/** Music wording that, outside the practical words, makes a practical sentence informative. */
function namesTheMusic(text: string): boolean {
  return !!deterministicGenreFromText(text) || hasExplicitDjOrRaveSignal(text) || /elektron|electronic|synth|\bmusi[ck]|\bbeats?\b|\bvokal|\bvocals?\b/i.test(text);
}

/**
 * A sentence tells the reviewer something about the event when it has no
 * practical wording at all, or when — after the practical words and filler
 * are set aside — at least three words remain and they name the music
 * ("Live experimental electronics door: free / donation"). A lone genre word
 * inside a practical sentence ("Gratis entré til techno i gården") is not
 * enough on its own.
 */
function isInformativeSentence(sentence: string): boolean {
  if (!PRACTICAL_RE.test(sentence)) return true;
  const remaining = (sentence.match(/[\p{L}\d][\p{L}\d'’-]*/gu) ?? []).filter(
    (word) => !PRACTICAL_RE.test(word) && !FILLER_WORDS.has(word.toLowerCase()),
  );
  return remaining.length >= 3 && namesTheMusic(remaining.join(" "));
}

export function isPracticalInfoOnly(text: string): boolean {
  const sentences = text
    .trim()
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}]/u.test(s));
  return !sentences.some(isInformativeSentence);
}

/** The description worth storing on a Discovery Queue row: null when empty or practical-only. */
export function usableDiscoveryDescription(text: string | null | undefined): string | null {
  if (!text || isPracticalInfoOnly(text)) return null;
  return text;
}
