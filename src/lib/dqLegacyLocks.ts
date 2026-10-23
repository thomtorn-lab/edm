/**
 * Read-only count of Discovery Queue rows carrying the historical
 * "everything locked" pattern (editorial screening, Gap A — 2026-10-18).
 *
 * Before #151 (merged 2026-10-18T07:41:37Z) every DQ "Save edit" and
 * "Add event from URL" save marked every posted field as overridden, and
 * publishDiscoveryItem carries those onto the event. A pending row with all
 * eleven publish-mapped field groups locked therefore becomes an event with
 * all twelve content/link fields locked the moment it is published.
 *
 * Discovery Queue rows keep no edit history (no updated_at, no change log),
 * so this cannot tell a deliberate correction from a field that was merely
 * re-saved. It counts the pattern and the metadata that exists; it never
 * guesses which locks are real.
 */

/** DQ override keys that publishDiscoveryItem maps onto event fields, grouped as the publish mapping groups them. */
export const PUBLISH_MAPPED_GROUPS: { group: string; dqKeys: string[]; eventFields: string[] }[] = [
  { group: "officialEventUrl", dqKeys: ["probableOfficialEventUrl"], eventFields: ["officialEventUrl"] },
  { group: "ticketUrl", dqKeys: ["probableTicketUrl"], eventFields: ["ticketUrl"] },
  { group: "residentAdvisorUrl", dqKeys: ["probableResidentAdvisorUrl"], eventFields: ["residentAdvisorUrl"] },
  { group: "description", dqKeys: ["description"], eventFields: ["description"] },
  { group: "title", dqKeys: ["probableTitle"], eventFields: ["title"] },
  { group: "startDatetime", dqKeys: ["probableStart"], eventFields: ["startDatetime"] },
  { group: "endDatetime", dqKeys: ["probableEnd"], eventFields: ["endDatetime"] },
  { group: "venueId", dqKeys: ["probableVenueName"], eventFields: ["venueId"] },
  { group: "subVenue", dqKeys: ["probableSubVenue"], eventFields: ["subVenue"] },
  { group: "artists", dqKeys: ["detectedLineup"], eventFields: ["artists"] },
  { group: "genre", dqKeys: ["predictedGenre", "predictedSecondaryGenre"], eventFields: ["primaryGenre", "subgenres"] },
];

/** Keys a full-form save always posted but an editor rarely changes on purpose — their presence marks a whole-form save, not an edit. */
export const FULL_FORM_MARKER_KEYS = ["probableFree", "predictedSecondaryGenre"] as const;

export const PR_151_MERGED_AT = new Date("2026-10-18T07:41:37Z");
export const RECENTLY_SEEN_DAYS = 14;
export const ID_LIST_CAP = 50;

export interface DqLockRow {
  id: string;
  sourceId: string | null;
  overriddenFields: string[];
  probableStart: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
}

export function mappedGroupCount(overriddenFields: string[]): number {
  const keys = new Set(overriddenFields);
  return PUBLISH_MAPPED_GROUPS.filter((g) => g.dqKeys.some((k) => keys.has(k))).length;
}

export function eventFieldsLockedOnPublish(overriddenFields: string[]): number {
  const keys = new Set(overriddenFields);
  return PUBLISH_MAPPED_GROUPS.filter((g) => g.dqKeys.some((k) => keys.has(k))).reduce((n, g) => n + g.eventFields.length, 0);
}

export interface DqLegacyLockReport {
  pendingRows: number;
  /** Pending rows by how many event fields publishing them would lock (0–12). */
  byEventFieldsLocked: { eventFields: number; rows: number }[];
  fullPattern: {
    rows: number;
    /** Start in the future, so the row can still be published. */
    publishable: number;
    /** Publishable, and the source listed it within RECENTLY_SEEN_DAYS (or it is an admin row with no source). */
    publishableAndCurrent: number;
    withFullFormMarker: number;
    createdBeforePr151: number;
    createdAfterPr151: number;
    bySource: { source: string; rows: number; publishable: number }[];
    publishableIds: { count: number; ids: string[]; truncated: boolean };
  };
  /** Pending rows with some, but not all, mapped groups locked. */
  partialPattern: { rows: number; publishable: number; createdAfterPr151: number };
}

export function buildDqLegacyLockReport(rows: DqLockRow[], now: Date): DqLegacyLockReport {
  const recentCutoff = new Date(now.getTime() - RECENTLY_SEEN_DAYS * 86_400_000);
  const publishable = (r: DqLockRow) => r.probableStart != null && r.probableStart.getTime() >= now.getTime();
  const current = (r: DqLockRow) => r.sourceId == null || (r.lastSeenAt != null && r.lastSeenAt.getTime() >= recentCutoff.getTime());

  const histogram = new Map<number, number>();
  for (const r of rows) {
    const n = eventFieldsLockedOnPublish(r.overriddenFields);
    histogram.set(n, (histogram.get(n) ?? 0) + 1);
  }

  const full = rows.filter((r) => mappedGroupCount(r.overriddenFields) === PUBLISH_MAPPED_GROUPS.length);
  const partial = rows.filter((r) => {
    const n = mappedGroupCount(r.overriddenFields);
    return n > 0 && n < PUBLISH_MAPPED_GROUPS.length;
  });

  const sourceMap = new Map<string, { source: string; rows: number; publishable: number }>();
  for (const r of full) {
    const source = r.sourceId ?? "(admin: Add event from URL)";
    const e = sourceMap.get(source) ?? { source, rows: 0, publishable: 0 };
    e.rows += 1;
    if (publishable(r)) e.publishable += 1;
    sourceMap.set(source, e);
  }

  const publishableFullIds = full.filter(publishable).map((r) => r.id).sort();
  return {
    pendingRows: rows.length,
    byEventFieldsLocked: [...histogram.entries()].map(([eventFields, n]) => ({ eventFields, rows: n })).sort((a, b) => a.eventFields - b.eventFields),
    fullPattern: {
      rows: full.length,
      publishable: full.filter(publishable).length,
      publishableAndCurrent: full.filter((r) => publishable(r) && current(r)).length,
      withFullFormMarker: full.filter((r) => FULL_FORM_MARKER_KEYS.some((k) => r.overriddenFields.includes(k))).length,
      createdBeforePr151: full.filter((r) => r.createdAt.getTime() < PR_151_MERGED_AT.getTime()).length,
      createdAfterPr151: full.filter((r) => r.createdAt.getTime() >= PR_151_MERGED_AT.getTime()).length,
      bySource: [...sourceMap.values()].sort((a, b) => b.rows - a.rows || a.source.localeCompare(b.source)),
      publishableIds: { count: publishableFullIds.length, ids: publishableFullIds.slice(0, ID_LIST_CAP), truncated: publishableFullIds.length > ID_LIST_CAP },
    },
    partialPattern: {
      rows: partial.length,
      publishable: partial.filter(publishable).length,
      createdAfterPr151: partial.filter((r) => r.createdAt.getTime() >= PR_151_MERGED_AT.getTime()).length,
    },
  };
}
