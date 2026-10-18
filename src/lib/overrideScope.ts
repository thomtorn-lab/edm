/**
 * Read-only lock-scope report (editorial screening, override release prep —
 * 2026-10-18). Pure aggregation over upcoming published events: how many
 * carry manual field locks (`overriddenFields`), on which fields, from which
 * sources, and how many events several sources match. Feeds
 * inspectSource.ts --mode=override-scope-audit; never writes anything.
 *
 * Output is deliberately aggregate: counts plus capped event-ID lists. No
 * titles, descriptions or field values, and no actor beyond the existing
 * "admin" / source-id labels the change log already uses.
 */

/** The content fields an editor checks first; "all locked" means a source can correct none of them. */
export const CORE_CONTENT_FIELDS = ["title", "description", "artists", "startDatetime", "venueId", "primaryGenre"] as const;

/** Upper bound on any event-ID list in the report — enough to investigate, never a dump. */
export const EVENT_ID_LIST_CAP = 50;

export interface OverrideScopeEventRow {
  id: string;
  canonicalSourceId: string | null;
  overriddenFields: string[];
  /** Distinct sources with a source_event_links row for this event. */
  linkedSourceIds: string[];
  /** Distinct sources whose sync wrote a change-log row for this event in the lookback window. */
  recentlySyncingSourceIds: string[];
  /** `changed_by` of the event's change-log "create" row, or null when none exists. */
  createdBy: string | null;
  /** Fields named in any admin-authored change-log row (update/publish/unpublish/admin_*). */
  adminLoggedFields: string[];
}

export interface CappedIdList {
  count: number;
  eventIds: string[];
  truncated: boolean;
}

export interface FieldLockCount {
  field: string;
  locked: number;
  /** A logged admin edit names this field — the lock is documented by the change log. */
  documentedByAdminEdit: number;
  /** No logged admin edit names this field — the change log does not say how it was locked. */
  noLoggedAdminEdit: number;
}

export interface SourceBreakdown {
  /** Canonical source id, or "(none: admin-created)". */
  source: string;
  events: number;
  withAnyLock: number;
  allCoreContentLocked: number;
}

export interface OverrideScopeReport {
  upcomingPublishedEvents: number;
  withAnyLock: CappedIdList;
  lockCountsByField: FieldLockCount[];
  allCoreContentLocked: CappedIdList;
  bySource: SourceBreakdown[];
  /** Events with 2+ distinct linked or recently syncing sources. */
  multipleSources: CappedIdList & { withAnyLock: number };
  /** Change-log "create" actor for locked events (e.g. "admin", "admin-paste", a source id, "(no create row)"). */
  lockedEventsByCreator: { createdBy: string; events: number }[];
}

export const NO_CANONICAL_SOURCE = "(none: admin-created)";
const NO_CREATE_ROW = "(no create row)";

function capped(ids: string[]): CappedIdList {
  const sorted = [...ids].sort();
  return { count: sorted.length, eventIds: sorted.slice(0, EVENT_ID_LIST_CAP), truncated: sorted.length > EVENT_ID_LIST_CAP };
}

function hasAllCoreContentLocked(row: OverrideScopeEventRow): boolean {
  return CORE_CONTENT_FIELDS.every((field) => row.overriddenFields.includes(field));
}

function distinctSources(row: OverrideScopeEventRow): Set<string> {
  return new Set([...row.linkedSourceIds, ...row.recentlySyncingSourceIds]);
}

export function buildOverrideScopeReport(rows: OverrideScopeEventRow[]): OverrideScopeReport {
  const locked = rows.filter((r) => r.overriddenFields.length > 0);

  const fieldCounts = new Map<string, FieldLockCount>();
  for (const row of locked) {
    const adminLogged = new Set(row.adminLoggedFields);
    for (const field of new Set(row.overriddenFields)) {
      const entry = fieldCounts.get(field) ?? { field, locked: 0, documentedByAdminEdit: 0, noLoggedAdminEdit: 0 };
      entry.locked += 1;
      if (adminLogged.has(field)) entry.documentedByAdminEdit += 1;
      else entry.noLoggedAdminEdit += 1;
      fieldCounts.set(field, entry);
    }
  }

  const sourceMap = new Map<string, SourceBreakdown>();
  for (const row of rows) {
    const source = row.canonicalSourceId ?? NO_CANONICAL_SOURCE;
    const entry = sourceMap.get(source) ?? { source, events: 0, withAnyLock: 0, allCoreContentLocked: 0 };
    entry.events += 1;
    if (row.overriddenFields.length > 0) entry.withAnyLock += 1;
    if (hasAllCoreContentLocked(row)) entry.allCoreContentLocked += 1;
    sourceMap.set(source, entry);
  }

  const multi = rows.filter((r) => distinctSources(r).size >= 2);

  const creatorMap = new Map<string, number>();
  for (const row of locked) {
    const key = row.createdBy ?? NO_CREATE_ROW;
    creatorMap.set(key, (creatorMap.get(key) ?? 0) + 1);
  }

  return {
    upcomingPublishedEvents: rows.length,
    withAnyLock: capped(locked.map((r) => r.id)),
    lockCountsByField: [...fieldCounts.values()].sort((a, b) => b.locked - a.locked || a.field.localeCompare(b.field)),
    allCoreContentLocked: capped(rows.filter(hasAllCoreContentLocked).map((r) => r.id)),
    bySource: [...sourceMap.values()].sort((a, b) => b.events - a.events || a.source.localeCompare(b.source)),
    multipleSources: { ...capped(multi.map((r) => r.id)), withAnyLock: multi.filter((r) => r.overriddenFields.length > 0).length },
    lockedEventsByCreator: [...creatorMap.entries()]
      .map(([createdBy, events]) => ({ createdBy, events }))
      .sort((a, b) => b.events - a.events || a.createdBy.localeCompare(b.createdBy)),
  };
}
