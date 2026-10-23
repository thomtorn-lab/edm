import type { Client } from "pg";
import { buildDqLegacyLockReport, ID_LIST_CAP, PUBLISH_MAPPED_GROUPS, RECENTLY_SEEN_DAYS, type DqLockRow } from "../lib/dqLegacyLocks";

/**
 * inspectSource.ts --mode=dq-legacy-lock-audit (read-only, Gap A). One
 * SELECT over pending Discovery Queue rows inside inspectSource's shared
 * withReadOnlyTx. Selects ids, source id, lock list and timestamps only —
 * never titles, descriptions, URLs or lineups.
 */
export const DQ_LEGACY_LOCK_SQL = `
  SELECT dq.id, dq.source_id, dq.overridden_fields, dq.probable_start, dq.last_seen_at, dq.created_at
  FROM discovery_queue dq
  WHERE dq.status = 'pending'
  ORDER BY dq.created_at
`;

export function mapDqLockRow(r: Record<string, unknown>): DqLockRow {
  const toDate = (v: unknown) => (v == null ? null : new Date(v as string | Date));
  return {
    id: r.id as string,
    sourceId: (r.source_id as string | null) ?? null,
    overriddenFields: Array.isArray(r.overridden_fields) ? (r.overridden_fields as unknown[]).filter((x): x is string => typeof x === "string") : [],
    probableStart: toDate(r.probable_start),
    lastSeenAt: toDate(r.last_seen_at),
    createdAt: toDate(r.created_at) ?? new Date(0),
  };
}

export async function runDqLegacyLockAudit(client: Pick<Client, "query">, now = new Date(), log: (line: string) => void = console.log) {
  const result = await client.query(DQ_LEGACY_LOCK_SQL);
  const report = buildDqLegacyLockReport(result.rows.map(mapDqLockRow), now);
  const f = report.fullPattern;

  log("\n=== dq-legacy-lock-audit: historical all-fields-locked pattern on pending Discovery Queue rows (read-only) ===");
  log(`Pending rows: ${report.pendingRows}`);
  log(`Full pattern (all ${PUBLISH_MAPPED_GROUPS.length} publish-mapped groups locked = all 12 event fields on publish): ${f.rows}`);
  log(`  publishable (start in the future): ${f.publishable}`);
  log(`  publishable and current (source listed it in the last ${RECENTLY_SEEN_DAYS} days, or admin row): ${f.publishableAndCurrent}`);
  log(`  carrying a full-form marker key (probableFree/predictedSecondaryGenre): ${f.withFullFormMarker}`);
  log(`  created before #151 merge: ${f.createdBeforePr151}, after: ${f.createdAfterPr151}`);
  log(`Partial pattern (some mapped groups locked): ${report.partialPattern.rows} (publishable: ${report.partialPattern.publishable}, created after #151: ${report.partialPattern.createdAfterPr151})`);
  log("\n--- Pending rows by event fields publishing would lock ---");
  for (const h of report.byEventFieldsLocked) log(`${h.eventFields}: ${h.rows}`);
  log("\n--- Full pattern by source ---");
  for (const s of f.bySource) log(`${s.source}: ${s.rows} (publishable: ${s.publishable})`);
  log(`\nPublishable full-pattern row ids (${f.publishableIds.count}${f.publishableIds.truncated ? `, first ${ID_LIST_CAP}` : ""}): ${f.publishableIds.ids.join(", ") || "-"}`);
  log("\nNote: Discovery Queue rows keep no edit history, so no figure here distinguishes a deliberate correction from a re-saved field.");
  return report;
}
