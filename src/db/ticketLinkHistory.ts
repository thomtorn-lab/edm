/**
 * Read-only runner for the historical ticket-link change analysis
 * (src/lib/ticketLinkHistory.ts). Five SELECTs over event_change_log and
 * events, run inside inspect-source's BEGIN READ ONLY transaction; no
 * writes, no network. Only aggregated counts and per-event writer sequences
 * are returned, never anything the log does not hold.
 */
import { analyzeTicketHistory, type ChangeLogRow, type HistoryEventRow, type SyncObservationRow, type TicketHistoryReport } from "@/lib/ticketLinkHistory";
import type { QueryClient } from "./auditEventsWindow";

export const TICKET_HISTORY_SQL = {
  coverage: "SELECT min(created_at) AS first_at, max(created_at) AS last_at, count(*)::int AS n FROM event_change_log",
  byType: "SELECT change_type, count(*)::int AS n FROM event_change_log GROUP BY change_type ORDER BY change_type",
  // create rows list every field (so they carry ticketUrl too) and give the creator.
  ticketRows: `SELECT event_id, changed_by, change_type, fields_changed, note, created_at FROM event_change_log
    WHERE 'ticketUrl' = ANY(fields_changed) OR note LIKE '%ticketUrl%' ORDER BY event_id, created_at, id`,
  observations: "SELECT event_id, changed_by, count(*)::int AS syncs FROM event_change_log WHERE change_type = 'sync' GROUP BY event_id, changed_by",
  events: "SELECT id, title, venue_id, start_datetime, canonical_source_id, ticket_url, overridden_fields, published FROM events",
} as const;

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(v as string)).toISOString();

export async function runTicketLinkHistory(client: QueryClient, now = new Date()): Promise<TicketHistoryReport> {
  const coverageRow = (await client.query(TICKET_HISTORY_SQL.coverage)).rows[0] as { first_at: unknown; last_at: unknown; n: number };
  const byType = (await client.query(TICKET_HISTORY_SQL.byType)).rows as { change_type: string; n: number }[];
  const logRows = ((await client.query(TICKET_HISTORY_SQL.ticketRows)).rows as Record<string, unknown>[]).map(
    (r): ChangeLogRow => ({
      event_id: r.event_id as string,
      changed_by: r.changed_by as string,
      change_type: r.change_type as string,
      fields_changed: (r.fields_changed as string[] | null) ?? [],
      note: (r.note as string | null) ?? null,
      created_at: iso(r.created_at),
    }),
  );
  const observations = (await client.query(TICKET_HISTORY_SQL.observations)).rows as SyncObservationRow[];
  const events = ((await client.query(TICKET_HISTORY_SQL.events)).rows as Record<string, unknown>[]).map(
    (r): HistoryEventRow => ({
      id: r.id as string,
      title: r.title as string,
      venue_id: (r.venue_id as string | null) ?? null,
      start_datetime: iso(r.start_datetime),
      canonical_source_id: (r.canonical_source_id as string | null) ?? null,
      ticket_url: (r.ticket_url as string | null) ?? null,
      overridden_fields: (r.overridden_fields as string[] | null) ?? [],
      published: r.published === true,
    }),
  );
  return analyzeTicketHistory({
    logRows,
    events,
    observations,
    coverage: {
      firstLogAt: coverageRow?.first_at ? iso(coverageRow.first_at) : null,
      lastLogAt: coverageRow?.last_at ? iso(coverageRow.last_at) : null,
      totalLogRows: coverageRow?.n ?? 0,
      rowsByType: Object.fromEntries(byType.map((t) => [t.change_type, t.n])),
    },
    now,
  });
}
