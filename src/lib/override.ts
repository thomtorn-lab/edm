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
  "subVenue",
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
  "postponed",
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

/**
 * How one field of an admin save relates to the value already stored
 * (editorial screening, priority 1 — 2026-10-17). Every admin form posts
 * its whole editor (AddEventFromUrl, DiscoveryQueue "Save edit"), so the
 * patch alone can't tell an edited field from one that was only displayed.
 *   - "changed":   the admin entered a different, non-empty value
 *   - "cleared":   a stored value was deliberately emptied (null/""/[])
 *   - "unchanged": the submitted value equals what is already stored
 * Only "changed" and "cleared" fields are written and newly protected.
 */
export type AdminFieldChange = "changed" | "cleared" | "unchanged";

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function normalizeForCompare(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v.trim() : v));
  return value;
}

/**
 * True when two stored/submitted values mean the same thing. Timestamps are
 * compared at minute precision: the admin datetime-local inputs can't express
 * seconds, so a seconds-only difference is a round-trip artefact of the form,
 * never an edit.
 */
export function adminValuesEqual(stored: unknown, submitted: unknown): boolean {
  if (isEmptyValue(stored) && isEmptyValue(submitted)) return true;
  if (isEmptyValue(stored) !== isEmptyValue(submitted)) return false;
  if (stored instanceof Date || submitted instanceof Date) {
    const a = asDate(stored);
    const b = asDate(submitted);
    if (!a || !b) return false;
    return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
  }
  return JSON.stringify(normalizeForCompare(stored)) === JSON.stringify(normalizeForCompare(submitted));
}

export function classifyAdminFieldChange(stored: unknown, submitted: unknown): AdminFieldChange {
  if (adminValuesEqual(stored, submitted)) return "unchanged";
  return isEmptyValue(submitted) ? "cleared" : "changed";
}

/**
 * Splits an admin patch against the stored row. `effectivePatch` keeps only
 * changed/cleared fields (plus any `alwaysTouched` key present in the patch,
 * for control fields whose write has side effects of its own). Existing
 * overrides are never removed here — callers merge `touchedFields` into the
 * stored list with addOverriddenFields.
 */
export function partitionAdminPatch<T extends object>(
  stored: object,
  patch: T,
  options: { alwaysTouched?: readonly string[] } = {},
): { effectivePatch: Partial<T>; touchedFields: string[]; changed: string[]; cleared: string[]; unchanged: string[] } {
  const alwaysTouched = new Set(options.alwaysTouched ?? []);
  const effectivePatch: Partial<T> = {};
  const changed: string[] = [];
  const cleared: string[] = [];
  const unchanged: string[] = [];
  const storedValues = stored as Record<string, unknown>;
  for (const key of Object.keys(patch) as (keyof T & string)[]) {
    const kind = classifyAdminFieldChange(storedValues[key], patch[key]);
    if (kind === "changed") changed.push(key);
    else if (kind === "cleared") cleared.push(key);
    else unchanged.push(key);
    if (kind !== "unchanged" || alwaysTouched.has(key)) effectivePatch[key] = patch[key];
  }
  return { effectivePatch, touchedFields: Object.keys(effectivePatch), changed, cleared, unchanged };
}
