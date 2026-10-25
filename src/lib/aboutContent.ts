import { isPracticalInfoOnly } from "./descriptionQuality";
import { isLikelyDanish } from "./languageDetection";

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
 * Sources whose Danish descriptions the public site does not show — their
 * adapters' English-language guard (pre-launch QA audit, 2026-08-29). Since
 * 2026-10-25 those adapters keep the text (RawCandidateEvent
 * .withheldDescription) for admin and the editorial audit, so the public
 * queries now apply the same rule at display time instead.
 */
export const SOURCES_WITHHOLDING_DANISH_DESCRIPTIONS: ReadonlySet<string> = new Set(["src-poolen", "src-pumpehuset"]);

/**
 * True when the public site must not show this event's stored description:
 * a Danish text (isLikelyDanish) on an event owned by one of the sources
 * above — exactly what their import guard used to drop. A description an
 * admin wrote or edited ("description" in overriddenFields) is always shown,
 * as it always was.
 */
export function isWithheldSourceDescription(event: {
  canonicalSourceId: string | null;
  description: string | null;
  overriddenFields: readonly string[];
}): boolean {
  if (!event.description || !event.canonicalSourceId) return false;
  if (!SOURCES_WITHHOLDING_DANISH_DESCRIPTIONS.has(event.canonicalSourceId)) return false;
  if (event.overriddenFields.includes("description")) return false;
  return isLikelyDanish(event.description);
}
