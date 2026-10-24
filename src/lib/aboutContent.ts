import { isPracticalInfoOnly } from "./descriptionQuality";

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

const BARE_LABEL_RE = /^(?:praktisk info(?:rmation)?|practical info(?:rmation)?|info(?:rmation)?|entr[ée]e?|admission|billetter|tickets?|pris(?:er)?|prices?)\s*[:.\-–]*\s*$/iu;

export function classifyAboutText(text: string | null | undefined): AboutKind | null {
  if (!text || !text.trim()) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.every((l) => BARE_LABEL_RE.test(l))) return "empty";
  return isPracticalInfoOnly(text) ? "practical" : "about";
}
