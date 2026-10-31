/**
 * Withheld source descriptions (2026-10-25). Poolen and Pumpehuset do not
 * publish Danish descriptions (their adapters' English-language guard, see
 * RawCandidateEvent.withheldDescription). The text is still kept for admin
 * and the editorial audit — as an event_change_log row of this type, never
 * in events.description. So the public site cannot show it, and no
 * description stored today changes or disappears.
 */
export const WITHHELD_DESCRIPTION_CHANGE_TYPE = "withheld_description";

/**
 * Whether a sync should record the source's withheld text: not when it is
 * already the event's stored description, and not when it repeats the last
 * text recorded for the event (one row per change, not per sync run).
 */
export function shouldRecordWithheldDescription(
  withheld: string | null | undefined,
  storedDescription: string | null,
  lastRecorded: string | null,
): boolean {
  if (!withheld?.trim()) return false;
  if (withheld === storedDescription) return false;
  return withheld !== lastRecorded;
}

/** The latest recorded text per event, from rows ordered newest first. */
export function latestWithheldByEvent(rows: { eventId: string; note: string | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.note && !(r.eventId in out)) out[r.eventId] = r.note;
  return out;
}
