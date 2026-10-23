/**
 * Historical ticket-link change analysis (thomtorn-lab/edm#145 background,
 * 2026-10-23). Pure: takes rows already read from event_change_log/events
 * and summarizes who changed ticketUrl, when, and in what order.
 *
 * What the log can and cannot say: applySourceSyncPatch writes one row per
 * matched event per sync with the source id and the NAMES of the fields it
 * changed, never the old or new values. So a sequence of writers per event
 * is documented ("src-billetto changed ticketUrl, then src-poolen changed it
 * back"), but which URL was involved, and whether a change was substantive
 * or only cosmetic (tracking parameters; the sync compares raw strings), is
 * not. A "create" row lists every field, so whether a link existed at
 * creation is unknown too. An "official link" below therefore means "the
 * last ticketUrl write before this one was made by an official source".
 */
import { getSourceById } from "./data/sources";

export interface ChangeLogRow {
  event_id: string;
  changed_by: string;
  change_type: string;
  fields_changed: string[];
  note: string | null;
  created_at: string;
}

export interface HistoryEventRow {
  id: string;
  title: string;
  venue_id: string | null;
  start_datetime: string;
  canonical_source_id: string | null;
  ticket_url: string | null;
  overridden_fields: string[];
  published: boolean;
}

/** Sync observations of one event by one source (whether or not anything changed). */
export interface SyncObservationRow {
  event_id: string;
  changed_by: string;
  syncs: number;
}

export type Authority = "official" | "ticketing" | "aggregator" | "admin" | "other";

export function authorityOf(changedBy: string): Authority {
  if (changedBy === "admin") return "admin";
  const t = getSourceById(changedBy)?.sourceType;
  if (t === "official-venue" || t === "official-promoter") return "official";
  if (t === "ticketing") return "ticketing";
  if (t === "general-aggregator" || t === "specialist-aggregator") return "aggregator";
  return "other";
}

export interface TicketWrite {
  at: string;
  by: string;
  authority: Authority;
  kind: "sync" | "admin";
}

export interface EventTicketHistory {
  eventId: string;
  title: string;
  venueId: string | null;
  night: string;
  upcoming: boolean;
  createdBy: string | null;
  canonicalSourceId: string | null;
  currentTicketHost: string | null;
  ticketOverridden: boolean;
  writes: TicketWrite[];
  /** Sync writes of ticketUrl by a non-official source right after an official source's write. */
  officialOverwrites: number;
  /** Of those, how many the same official source wrote back later. */
  restoredByOfficial: number;
  /** Consecutive sync writes by the same source (its own value kept changing). */
  sameSourceRewrites: number;
  /** Sync attempts on ticketUrl blocked by an admin override. */
  overrideBlocks: number;
  /** Source that made the last ticketUrl write (null: never changed after creation). */
  lastWriter: string | null;
  /** Official sources that synced this event at all (from the observation counts). */
  officialObservers: string[];
}

export interface TicketHistoryReport {
  coverage: { firstLogAt: string | null; lastLogAt: string | null; totalLogRows: number; rowsByType: Record<string, number> };
  totals: {
    syncTicketWrites: number;
    eventsWithSyncTicketWrites: number;
    adminTicketWrites: number;
    eventsWithAdminTicketWrites: number;
    overrideBlocks: number;
    eventsWithOverrideBlocks: number;
    eventsWithMultipleSyncWriters: number;
    officialOverwrites: number;
    eventsWithOfficialOverwrites: number;
    restoredByOfficial: number;
    eventsWithFlipFlop: number;
    sameSourceRewrites: number;
    eventsWithSameSourceRewrites: number;
    /** Events whose current link was last written by a non-official source although an official source also syncs the event. */
    eventsCurrentlyNonOfficialWhileOfficialSyncs: number;
  };
  bySource: { source: string; authority: Authority; syncTicketWrites: number; events: number; syncObservations: number; eventsObserved: number }[];
  /** "from -> to": a sync write by `to` directly after a write by `from`, different sources. */
  bySourcePair: { from: string; to: string; writes: number; events: number }[];
  byVenue: { venueId: string | null; eventsWithSyncTicketWrites: number; eventsWithFlipFlop: number; syncTicketWrites: number }[];
  events: EventTicketHistory[];
  limitations: readonly string[];
}

export const TICKET_HISTORY_LIMITATIONS = [
  "event_change_log stores only the names of changed fields, never old or new values: which URL was replaced, and whether a change was substantive or only cosmetic (e.g. tracking parameters; the sync compares raw strings), cannot be determined.",
  "The origin of a ticket link has never been stored: an \"official link\" here means the previous ticketUrl write came from an official source according to the log, not that the stored URL is known to be official.",
  "A create row lists every field, so whether an event had a ticket link at creation, and from whom, is unknown; writes are only counted from the first sync/admin change.",
  "History only covers the period the log spans; changes made outside writeChangeLog (direct SQL, data migrations, deleted test events) are not visible.",
  "Read-only analysis of existing rows; nothing was written and no external service was contacted.",
] as const;

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "(unparseable)";
  }
}

function inc<K>(m: Map<K, number>, k: K, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

export function analyzeTicketHistory(input: {
  logRows: ChangeLogRow[];
  events: HistoryEventRow[];
  observations: SyncObservationRow[];
  coverage: { firstLogAt: string | null; lastLogAt: string | null; totalLogRows: number; rowsByType: Record<string, number> };
  now: Date;
}): TicketHistoryReport {
  const eventsById = new Map(input.events.map((e) => [e.id, e]));
  const rowsByEvent = new Map<string, ChangeLogRow[]>();
  for (const r of input.logRows) {
    if (!rowsByEvent.has(r.event_id)) rowsByEvent.set(r.event_id, []);
    rowsByEvent.get(r.event_id)!.push(r);
  }
  const observersByEvent = new Map<string, Set<string>>();
  const obsBySource = new Map<string, number>();
  const obsEventsBySource = new Map<string, Set<string>>();
  for (const o of input.observations) {
    if (!observersByEvent.has(o.event_id)) observersByEvent.set(o.event_id, new Set());
    observersByEvent.get(o.event_id)!.add(o.changed_by);
    inc(obsBySource, o.changed_by, o.syncs);
    if (!obsEventsBySource.has(o.changed_by)) obsEventsBySource.set(o.changed_by, new Set());
    obsEventsBySource.get(o.changed_by)!.add(o.event_id);
  }

  const histories: EventTicketHistory[] = [];
  const pairWrites = new Map<string, number>();
  const pairEvents = new Map<string, Set<string>>();
  const writesBySource = new Map<string, number>();
  const eventsBySource = new Map<string, Set<string>>();

  for (const [eventId, rows] of [...rowsByEvent.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ev = eventsById.get(eventId);
    const createdBy = sorted.find((r) => r.change_type === "create")?.changed_by ?? null;
    const writes: TicketWrite[] = [];
    let overrideBlocks = 0;
    for (const r of sorted) {
      if (r.change_type === "create") continue;
      if (r.fields_changed.includes("ticketUrl")) {
        writes.push({ at: r.created_at, by: r.changed_by, authority: authorityOf(r.changed_by), kind: r.changed_by === "admin" ? "admin" : "sync" });
      }
      if (r.change_type === "sync" && r.note && /skipped manually-overridden fields:.*\bticketUrl\b/.test(r.note)) overrideBlocks++;
    }
    const syncWrites = writes.filter((w) => w.kind === "sync");
    if (syncWrites.length === 0 && overrideBlocks === 0 && writes.length === 0) continue;

    let officialOverwrites = 0;
    let restoredByOfficial = 0;
    let sameSourceRewrites = 0;
    for (let i = 0; i < writes.length; i++) {
      const w = writes[i];
      if (w.kind !== "sync") continue;
      inc(writesBySource, w.by);
      if (!eventsBySource.has(w.by)) eventsBySource.set(w.by, new Set());
      eventsBySource.get(w.by)!.add(eventId);
      const prev = writes[i - 1];
      if (!prev) continue;
      if (prev.by === w.by) {
        sameSourceRewrites++;
        continue;
      }
      const key = `${prev.by} -> ${w.by}`;
      inc(pairWrites, key);
      if (!pairEvents.has(key)) pairEvents.set(key, new Set());
      pairEvents.get(key)!.add(eventId);
      if (prev.authority === "official" && w.authority !== "official") {
        officialOverwrites++;
        if (writes.slice(i + 1).some((later) => later.kind === "sync" && later.by === prev.by)) restoredByOfficial++;
      }
    }
    const officialObservers = [...(observersByEvent.get(eventId) ?? [])].filter((s) => authorityOf(s) === "official").sort();
    const start = ev ? new Date(ev.start_datetime) : null;
    histories.push({
      eventId,
      title: ev?.title ?? "(event row not found)",
      venueId: ev?.venue_id ?? null,
      night: start ? start.toISOString().slice(0, 10) : "",
      upcoming: start ? start.getTime() + 24 * 3_600_000 > input.now.getTime() : false,
      createdBy,
      canonicalSourceId: ev?.canonical_source_id ?? null,
      currentTicketHost: hostOf(ev?.ticket_url ?? null),
      ticketOverridden: ev?.overridden_fields.includes("ticketUrl") ?? false,
      writes,
      officialOverwrites,
      restoredByOfficial,
      sameSourceRewrites,
      overrideBlocks,
      lastWriter: writes.at(-1)?.by ?? null,
      officialObservers,
    });
  }

  const sum = (f: (h: EventTicketHistory) => number) => histories.reduce((n, h) => n + f(h), 0);
  const count = (f: (h: EventTicketHistory) => boolean) => histories.filter(f).length;
  const isFlipFlop = (h: EventTicketHistory) => h.restoredByOfficial > 0;
  const syncWriters = (h: EventTicketHistory) => new Set(h.writes.filter((w) => w.kind === "sync").map((w) => w.by));

  const venues = new Map<string | null, { e: number; f: number; w: number }>();
  for (const h of histories) {
    const n = h.writes.filter((w) => w.kind === "sync").length;
    if (n === 0) continue;
    const v = venues.get(h.venueId) ?? { e: 0, f: 0, w: 0 };
    v.e++;
    v.w += n;
    if (isFlipFlop(h)) v.f++;
    venues.set(h.venueId, v);
  }

  const sources = new Set([...writesBySource.keys(), ...obsBySource.keys()]);
  return {
    coverage: input.coverage,
    totals: {
      syncTicketWrites: sum((h) => h.writes.filter((w) => w.kind === "sync").length),
      eventsWithSyncTicketWrites: count((h) => h.writes.some((w) => w.kind === "sync")),
      adminTicketWrites: sum((h) => h.writes.filter((w) => w.kind === "admin").length),
      eventsWithAdminTicketWrites: count((h) => h.writes.some((w) => w.kind === "admin")),
      overrideBlocks: sum((h) => h.overrideBlocks),
      eventsWithOverrideBlocks: count((h) => h.overrideBlocks > 0),
      eventsWithMultipleSyncWriters: count((h) => syncWriters(h).size > 1),
      officialOverwrites: sum((h) => h.officialOverwrites),
      eventsWithOfficialOverwrites: count((h) => h.officialOverwrites > 0),
      restoredByOfficial: sum((h) => h.restoredByOfficial),
      eventsWithFlipFlop: count(isFlipFlop),
      sameSourceRewrites: sum((h) => h.sameSourceRewrites),
      eventsWithSameSourceRewrites: count((h) => h.sameSourceRewrites > 0),
      eventsCurrentlyNonOfficialWhileOfficialSyncs: count(
        (h) => h.lastWriter !== null && h.lastWriter !== "admin" && authorityOf(h.lastWriter) !== "official" && h.officialObservers.length > 0,
      ),
    },
    bySource: [...sources]
      .map((s) => ({
        source: s,
        authority: authorityOf(s),
        syncTicketWrites: writesBySource.get(s) ?? 0,
        events: eventsBySource.get(s)?.size ?? 0,
        syncObservations: obsBySource.get(s) ?? 0,
        eventsObserved: obsEventsBySource.get(s)?.size ?? 0,
      }))
      .sort((a, b) => b.syncTicketWrites - a.syncTicketWrites || a.source.localeCompare(b.source)),
    bySourcePair: [...pairWrites.entries()]
      .map(([k, writes]) => {
        const [from, to] = k.split(" -> ");
        return { from, to, writes, events: pairEvents.get(k)!.size };
      })
      .sort((a, b) => b.events - a.events || b.writes - a.writes || `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`)),
    byVenue: [...venues.entries()]
      .map(([venueId, v]) => ({ venueId, eventsWithSyncTicketWrites: v.e, eventsWithFlipFlop: v.f, syncTicketWrites: v.w }))
      .sort((a, b) => b.eventsWithSyncTicketWrites - a.eventsWithSyncTicketWrites || String(a.venueId).localeCompare(String(b.venueId))),
    events: histories,
    limitations: TICKET_HISTORY_LIMITATIONS,
  };
}
