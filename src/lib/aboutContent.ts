import { isPracticalInfoOnly } from "./descriptionQuality";
import { isLikelyDanish, readsAsDanish } from "./languageDetection";

/**
 * What kind of text an event's stored description is, for presentation
 * only (About content quality, 2026-10-24). Real case: a KultuNaut listing
 * for a VEGA night whose whole "description" is VEGA's cloakroom,
 * accessibility and contact boilerplate — nothing about the event or its
 * artists.
 *
 * - "about": tells the reader about the event (anything beyond practical
 *   vocabulary — see isPracticalInfoOnly, reused unchanged from the
 *   Discovery Queue's description-quality rule).
 * - "practical": only practical venue information (tickets, doors,
 *   cloakroom, access, age, contact). Still shown in full — it can hold
 *   unique details such as an age limit — but labelled "Practical
 *   information" rather than presented as the event's About text.
 * - "empty": nothing but bare labels with no value ("Praktisk info:.",
 *   "Entré"), so there is no information to show.
 *
 * Never rewrites, reorders or drops any part of a mixed description, and
 * never changes the stored text.
 */
export type AboutKind = "about" | "practical" | "empty";

/** A label line with no value ("Entré", "Praktisk info:."). */
export const BARE_LABEL_RE = /^(?:praktisk info(?:rmation)?|practical info(?:rmation)?|info(?:rmation)?|entr[ée]e?|admission|billetter|tickets?|pris(?:er)?|prices?)\s*[:.\-–]*\s*$/iu;

export function classifyAboutText(text: string | null | undefined): AboutKind | null {
  if (!text || !text.trim()) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.every((l) => BARE_LABEL_RE.test(l))) return "empty";
  return isPracticalInfoOnly(text) ? "practical" : "about";
}

/**
 * Whether a description is Danish About text the English-language public
 * site must not show (QA 2026-11-15, real case: Hvaderpaa's "Syvende udgave
 * af klubnatten Whipped samler Matrixxman, … til en nat med elektronisk
 * dansemusik" — Danish grammar with no æ/ø/å, which isLikelyDanish alone
 * misses). Only "about" text is ever hidden: practical information (age
 * limit, doors, cloakroom) is still shown in any language, and plainly
 * English prose is never hidden (isLikelyDanish's own English exception;
 * readsAsDanish needs more Danish than English function words).
 * Presentation only: the stored description is never changed.
 */
export function isDanishAboutText(text: string | null | undefined): boolean {
  if (classifyAboutText(text) !== "about") return false;
  return isLikelyDanish(text!) || readsAsDanish(text!);
}
