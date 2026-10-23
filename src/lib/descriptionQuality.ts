import { deterministicGenreFromText, hasExplicitDjOrRaveSignal } from "./adapters/deterministicGenreMapping";

/**
 * Description quality for Discovery Queue rows (coverage work, 2026-10-23).
 * Concert-hall listings on KultuNaut often carry only the venue's practical
 * boilerplate as their "description" — Amager Bio's "Hvis der er udsolgt i
 * forsalg …", handicap seats, Ticketmaster's phone number, "Entré". Storing
 * that as the row's description tells a reviewer nothing, and would show up
 * publicly if the row were published as is.
 *
 * Deliberately conservative: a text counts as practical-only when EVERY
 * sentence matches the practical vocabulary below and nothing in it names a
 * genre or DJ/rave context. A single sentence about the music keeps the
 * whole text.
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

export function isPracticalInfoOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (deterministicGenreFromText(trimmed) || hasExplicitDjOrRaveSignal(trimmed) || /\belektron|\belectronic/i.test(trimmed)) return false;
  const sentences = trimmed
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}]/u.test(s));
  return sentences.length > 0 && sentences.every((s) => PRACTICAL_RE.test(s));
}

/** The description worth storing on a Discovery Queue row: null when empty or practical-only. */
export function usableDiscoveryDescription(text: string | null | undefined): string | null {
  if (!text || isPracticalInfoOnly(text)) return null;
  return text;
}
