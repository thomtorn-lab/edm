/**
 * Field-level manual-override protection (spec section 46; user directive
 * step 3). When an admin hand-corrects a field, that field name is recorded
 * on the event. Any later automated sync must strip those fields out of its
 * proposed update before applying it — a human correction is never silently
 * clobbered by the next scheduled sync.
 */

/** Fields an admin can hand-correct, and therefore fields a sync must be able to skip. */
export const EDITABLE_EVENT_FIELDS = [
  "title",
  "description",
  "artists",
  "startDatetime",
  "endDatetime",
  "venueId",
  "primaryGenre",
  "subgenres",
  "officialEventUrl",
  "ticketUrl",
  "facebookUrl",
  "residentAdvisorUrl",
  "otherSourceUrls",
  "imageUrl",
  "priceFrom",
  "soldOut",
  "cancelled",
  "dateChanged",
  "timeChanged",
  "published",
] as const;

export type EditableEventField = (typeof EDITABLE_EVENT_FIELDS)[number];

export function isEditableEventField(field: string): field is EditableEventField {
  return (EDITABLE_EVENT_FIELDS as readonly string[]).includes(field);
}

/** Merges newly-edited field names into the existing override list, deduplicated. */
export function addOverriddenFields(existing: string[], newlyEdited: string[]): string[] {
  return Array.from(new Set([...existing, ...newlyEdited]));
}

/**
 * Strips any key present in `overriddenFields` out of a sync-proposed patch.
 * This is the enforcement point: whatever an adapter/sync wants to change,
 * only the non-protected subset ever reaches the database.
 */
export function stripOverriddenFields<T extends Record<string, unknown>>(
  incomingPatch: T,
  overriddenFields: string[],
): Partial<T> {
  const protectedSet = new Set(overriddenFields);
  const result: Partial<T> = {};
  for (const key of Object.keys(incomingPatch) as (keyof T)[]) {
    if (protectedSet.has(key as string)) continue;
    result[key] = incomingPatch[key];
  }
  return result;
}
