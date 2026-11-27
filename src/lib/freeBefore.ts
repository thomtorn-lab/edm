import { getCopenhagenParts } from "./datetime";
import { isFreeAdmission } from "./links";
import type { EventRecord } from "./types";

/**
 * "Free Before" — free admission when arriving before a stated time, read
 * conservatively from the event's existing description (About text). Never
 * stored, never rewrites the text. Only an explicit "free [entry] before /
 * until / till <time>" (or the Danish "gratis [entré] / fri entré før /
 * indtil <time>") counts; anything that looks conditional or contradicts
 * the event's own start time is left out.
 *
 * Real examples it accepts: "Free till 23:00 · 120 DKK after",
 * "Free until 23, 75kr (After 23)", "Free entrance if you arrive before 23:00",
 * "Free before 21:00 | 70 DKK after". Real examples it rejects:
 * "Free before 22:00 (Vernissage)" (a separate activity), "2 for 1 before
 * 00:30", "Early bird (entry before 1AM) - 70 kr", "Entrance is free from
 * 22:00 to 23:00" (a window, not "before"), and a templated "23.00–05.00 Free
 * entry until 22.00" (the free time is before the event even starts).
 */

const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?(?![\d/])(?!\s*(?:\.|-)?\s*(?:jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec))`;

const PATTERNS = [
  // English: "Free before 23:00", "Free entry until 22.00", "Free till 23",
  // "Free entrance if you arrive before 23:00".
  new RegExp(String.raw`\bfree(?:\s+(?:entry|entrance|admission))?\s+(?:if\s+you\s+arrive\s+)?(?:before|until|till)\s+${TIME}`, "gi"),
  // Danish: "Gratis entré før kl. 23.00", "Fri entré indtil kl. 22", "Gratis før 23".
  new RegExp(
    String.raw`(?:\bgratis(?:\s+(?:entré|entre|adgang|indgang))?|\bfri\s+(?:entré|entre|adgang|indgang))\s+(?:før|indtil|til)\s+(?:kl\.?\s*)?${TIME}`,
    "gi",
  ),
];

/** Words that make free admission conditional or about something else — any of them near the phrase rules it out. */
const CONDITIONAL =
  /guest\s*-?\s*list|gæsteliste|invit|member|medlem|rsvp|sign[\s-]?up|tilmeld|registr|student|vernissage|fernis|exhibition|udstilling|auction|drink|beer|øl|wardrobe|garderobe|locker|shot/i;

/** Longest wait from start to the free-until time that still reads as "arrive early" (wall-clock minutes). */
const MAX_MINUTES_AFTER_START = 12 * 60;

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

/**
 * The "HH:MM" free-admission cutoff stated in the description, or null when
 * there is none, it is conditional, there are several different ones, or it
 * is not after the event's own start time.
 */
export function detectFreeBefore(event: Pick<EventRecord, "description" | "startDatetime">): string | null {
  const text = (event.description ?? "").replace(/\s+/g, " ");
  if (!text) return null;

  const found = new Set<number>();
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const minutes = normalize(Number(m[1]), m[2] ? Number(m[2]) : 0);
      if (minutes === null) return null;
      const end = (m.index ?? 0) + m[0].length;
      // "(Vernissage)", "(members)" etc. straight after the time qualifies it.
      if (/^\s*\(/.test(text.slice(end))) return null;
      if (CONDITIONAL.test(segmentAround(text, m.index ?? 0, end))) return null;
      found.add(minutes);
    }
  }
  if (found.size !== 1) return null;

  const [minutes] = found;
  const start = getCopenhagenParts(new Date(event.startDatetime));
  const startMinutes = start.hour * 60 + start.minute;
  const wait = (minutes - startMinutes + 24 * 60) % (24 * 60);
  if (wait === 0 || wait > MAX_MINUTES_AFTER_START) return null;

  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export type AdmissionStatus = { kind: "free" } | { kind: "free-before"; time: string };

/**
 * The one admission status shown and filtered on. A stated Free Before time
 * is the more precise of the two, so it wins over a bare FREE (priceFrom = 0)
 * and the two are never shown together.
 */
export function admissionStatus(
  event: Pick<EventRecord, "description" | "startDatetime" | "priceFrom">,
): AdmissionStatus | null {
  const time = detectFreeBefore(event);
  if (time) return { kind: "free-before", time };
  return isFreeAdmission(event) ? { kind: "free" } : null;
}
