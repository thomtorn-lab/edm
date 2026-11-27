import { isFreeAdmission } from "./links";
import type { EventRecord } from "./types";

/**
 * "Free Before" — free admission when arriving before a stated time. Never
 * stored, never rewrites the text. Two sources, in this order:
 *
 * 1. The event's own description (About text). Only an explicit "free
 *    [entry] before / until / till <time>", "entrance is free [from <time>]
 *    to <time>", or the Danish "gratis [entré] / fri entré før / indtil
 *    <time>" counts — whatever the event's listed start time (venues often
 *    open their doors before the programme starts). Anything that looks
 *    conditional or names several different times is left out, and then
 *    no venue default is used either.
 * 2. Otherwise, a venue where free entry before a set time is standard
 *    (VENUE_FREE_BEFORE).
 *
 * Real examples it accepts: "Free till 23:00 · 120 DKK after",
 * "Free until 23, 75kr (After 23)", "Free entrance if you arrive before 23:00",
 * "23.00–05.00 Free entry until 22.00", "Entrance is free from 22:00 to 23:00".
 * Real examples it rejects: "Free before 22:00 (Vernissage)" (a separate
 * activity), "2 for 1 before 00:30", "Early bird (entry before 1AM) - 70 kr".
 */

/**
 * Venues where free entry before a set time is the house rule. Jolene Bar:
 * every Jolene description that states an entry time says "Free entry until
 * 22.00" (11 events, Sep–Dec 2026), none another time.
 */
const VENUE_FREE_BEFORE: Record<string, string> = {
  jolene: "22:00",
};

const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?(?![\d/])(?!\s*(?:\.|-)?\s*(?:jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec))`;

const PATTERNS = [
  // English: "Free before 23:00", "Free entry until 22.00", "Free till 23",
  // "Free entrance if you arrive before 23:00".
  new RegExp(String.raw`\bfree(?:\s+(?:entry|entrance|admission))?\s+(?:if\s+you\s+arrive\s+)?(?:before|until|till)\s+${TIME}`, "gi"),
  // "Entrance is free from 22:00 to 23:00", "Entry is free until 23".
  new RegExp(
    String.raw`\b(?:entry|entrance|admission)\s+is\s+free\s+(?:from\s+\d{1,2}(?:[:.]\d{2})?\s+)?(?:to|until|till|before)\s+${TIME}`,
    "gi",
  ),
  // Danish: "Gratis entré før kl. 23.00", "Fri entré indtil kl. 22", "Gratis før 23".
  new RegExp(
    String.raw`(?:\bgratis(?:\s+(?:entré|entre|adgang|indgang))?|\bfri\s+(?:entré|entre|adgang|indgang))\s+(?:før|indtil|til)\s+(?:kl\.?\s*)?${TIME}`,
    "gi",
  ),
];

/** Words that make free admission conditional or about something else — any of them near the phrase rules it out. */
const CONDITIONAL =
  /guest\s*-?\s*list|gæsteliste|invit|member|medlem|rsvp|sign[\s-]?up|tilmeld|registr|student|vernissage|fernis|exhibition|udstilling|auction|drink|beer|øl|wardrobe|garderobe|locker|shot/i;

/** The phrase's own clause: up to the nearest "·", "|", "•", "!", "?" or sentence-ending ". " on each side. */
function segmentAround(text: string, start: number, end: number): string {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const from = Math.max(...[...before.matchAll(/[·|•!?]|\.\s/g)].map((d) => (d.index ?? 0) + d[0].length), 0);
  const stop = after.search(/[·|•!?]|\.\s/);
  return text.slice(from, stop === -1 ? text.length : end + stop);
}

function normalize(hour: number, minute: number): number | null {
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return null;
  return (hour % 24) * 60 + minute;
}

/** What the description says: a time, "ambiguous" (a phrase that can't be trusted), or nothing. */
function fromDescription(description: string | null): string | "ambiguous" | null {
  const text = (description ?? "").replace(/\s+/g, " ");
  if (!text) return null;

  const found = new Set<number>();
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const minutes = normalize(Number(m[1]), m[2] ? Number(m[2]) : 0);
      if (minutes === null) return "ambiguous";
      const end = (m.index ?? 0) + m[0].length;
      // "(Vernissage)", "(members)" etc. straight after the time qualifies it.
      if (/^\s*\(/.test(text.slice(end))) return "ambiguous";
      if (CONDITIONAL.test(segmentAround(text, m.index ?? 0, end))) return "ambiguous";
      found.add(minutes);
    }
  }
  if (found.size === 0) return null;
  if (found.size > 1) return "ambiguous";
  const [minutes] = found;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

type FreeBeforeInput = Pick<EventRecord, "description"> & { venue?: { slug: string } };

/** The "HH:MM" free-admission cutoff for an event, or null when none is known. */
export function detectFreeBefore(event: FreeBeforeInput): string | null {
  const stated = fromDescription(event.description);
  if (stated === "ambiguous") return null;
  if (stated) return stated;
  return (event.venue && VENUE_FREE_BEFORE[event.venue.slug]) ?? null;
}

export type AdmissionStatus = { kind: "free" } | { kind: "free-before"; time: string };

/**
 * The one admission status shown and filtered on, never both:
 * 1. a Free Before time stated in the description (more precise than a bare
 *    price of 0, so it wins over FREE);
 * 2. FREE (priceFrom = 0);
 * 3. the venue's standard Free Before time.
 */
export function admissionStatus(event: FreeBeforeInput & Pick<EventRecord, "priceFrom">): AdmissionStatus | null {
  const stated = fromDescription(event.description);
  if (stated === "ambiguous") return isFreeAdmission(event) ? { kind: "free" } : null;
  if (stated) return { kind: "free-before", time: stated };
  if (isFreeAdmission(event)) return { kind: "free" };
  const venueTime = event.venue && VENUE_FREE_BEFORE[event.venue.slug];
  return venueTime ? { kind: "free-before", time: venueTime } : null;
}
