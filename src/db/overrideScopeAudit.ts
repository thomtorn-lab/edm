import type { Client } from "pg";
import { buildOverrideScopeReport, CORE_CONTENT_FIELDS, EVENT_ID_LIST_CAP, type OverrideScopeEventRow } from "../lib/overrideScope";

/**
 * Read-only lock-scope audit (inspectSource.ts --mode=override-scope-audit).
 * One SELECT over upcoming published events, run inside inspectSource's
 * shared withReadOnlyTx (BEGIN READ ONLY ... ROLLBACK). Selects ids, the
 * canonical source, the lock list and change-log/source-link metadata only —
 * never titles, descriptions, URLs or other field values.
 *
 * "Upcoming" = published and start_datetime >= now(). "Recently syncing" =
 * a sync change-log row in the last 30 days.
 */
export const OVERRIDE_SCOPE_SQL = `
  SELECT
    e.id,
    e.canonical_source_id,
    e.overridden_fields,
    COALESCE(
      (SELECT array_agg(DISTINCT l.source_id) FROM source_event_links l WHERE l.event_id = e.id),
      '{}'
    ) AS linked_source_ids,
    COALESCE(
      (SELECT array_agg(DISTINCT c.changed_by) FROM event_change_log c
        WHERE c.event_id = e.id AND c.change_type = 'sync' AND c.created_at >= now() - interval '30 days'),
      '{}'
    ) AS recently_syncing_source_ids,
    (SELECT c.changed_by FROM event_change_log c
      WHERE c.event_id = e.id AND c.change_type = 'create'
      ORDER BY c.created_at ASC LIMIT 1) AS created_by,
    COALESCE(
      (SELECT array_agg(DISTINCT f) FROM event_change_log c, unnest(c.fields_changed) AS f
        WHERE c.event_id = e.id AND c.changed_by = 'admin' AND c.change_type <> 'create'),
      '{}'
    ) AS admin_logged_fields
  FROM events e
  WHERE e.published = true AND e.start_datetime >= now()
  ORDER BY e.start_datetime
`;

export function mapOverrideScopeRow(r: Record<string, unknown>): OverrideScopeEventRow {
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []);
  return {
    id: r.id as string,
    canonicalSourceId: (r.canonical_source_id as string | null) ?? null,
    overriddenFields: arr(r.overridden_fields),
    linkedSourceIds: arr(r.linked_source_ids),
    recentlySyncingSourceIds: arr(r.recently_syncing_source_ids),
    createdBy: (r.created_by as string | null) ?? null,
    adminLoggedFields: arr(r.admin_logged_fields),
  };
}

export async function runOverrideScopeAudit(client: Pick<Client, "query">, log: (line: string) => void = console.log) {
  const result = await client.query(OVERRIDE_SCOPE_SQL);
  const report = buildOverrideScopeReport(result.rows.map(mapOverrideScopeRow));

  log("\n=== override-scope-audit: manual field locks on upcoming published events (read-only) ===");
  log(`Upcoming published events: ${report.upcomingPublishedEvents}`);
  log(`With at least one lock: ${report.withAnyLock.count}`);
  log(`With all core content fields locked (${CORE_CONTENT_FIELDS.join(", ")}): ${report.allCoreContentLocked.count}`);
  log(`Matched by 2+ sources (linked or syncing in the last 30 days): ${report.multipleSources.count} (of which locked: ${report.multipleSources.withAnyLock})`);

  log("\n--- Locks by field (documented = a logged admin edit names the field; not logged = the change log does not say how it was locked) ---");
  for (const f of report.lockCountsByField) {
    log(`${f.field}: ${f.locked} (documented by admin edit: ${f.documentedByAdminEdit}, not logged: ${f.noLoggedAdminEdit})`);
  }

  log("\n--- By canonical source ---");
  for (const s of report.bySource) {
    log(`${s.source}: ${s.events} events, ${s.withAnyLock} with a lock, ${s.allCoreContentLocked} with all core content locked`);
  }

  log("\n--- Locked events by change-log creator ---");
  for (const c of report.lockedEventsByCreator) log(`${c.createdBy}: ${c.events}`);

  const ids = (label: string, list: { count: number; eventIds: string[]; truncated: boolean }) =>
    log(`\n${label} (${list.count}${list.truncated ? `, first ${EVENT_ID_LIST_CAP}` : ""}): ${list.eventIds.join(", ") || "-"}`);
  ids("Event ids — all core content locked", report.allCoreContentLocked);
  ids("Event ids — matched by 2+ sources", report.multipleSources);

  return report;
}
