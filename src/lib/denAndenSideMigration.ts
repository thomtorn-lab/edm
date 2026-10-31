import { DEN_ANDEN_SIDE_VENUE_ID, SMALL_ROOM, structureDenAndenSideRooms, type RoomVerdict } from "./denAndenSideRooms";
import { getCopenhagenParts } from "./datetime";

/**
 * One-time review of every event already stored for Den Anden Side (and any
 * stray "Den Anden Ende" venue row), planned with the exact same pure logic
 * future imports run (structureDenAndenSideRooms in the ingestion pipeline),
 * so a migrated event and a freshly synced one converge on one shape — the
 * Den Anden Side counterpart of cultureBoxConsolidation.ts. DB-free and
 * unit-tested; src/db/denAndenSideRoomStructure.ts loads and writes.
 *
 * Never changes id, slug, URLs, dates, genre or publish state. Only title,
 * description and artist ORDER change (the same artists, never more or
 * fewer), plus venueId for events filed under a separate "Den Anden Ende"
 * venue. A change that would touch an admin-overridden field is not made:
 * it is reported for manual review instead.
 */

export interface DasEventSnapshot {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  artists: string[];
  venueId: string;
  venueName: string | null;
  startDatetime: string;
  published: boolean;
  cancelled: boolean;
  overriddenFields: string[];
  canonicalSourceId: string | null;
  officialEventUrl: string | null;
  residentAdvisorUrl: string | null;
}

export type PlanOutcome = "update" | "unchanged" | "unresolved";

export interface DasEventPlan {
  event: DasEventSnapshot;
  outcome: PlanOutcome;
  verdict: RoomVerdict;
  reason: string;
  patch: { title?: string; description?: string | null; artists?: string[]; venueId?: string };
}

export interface SameNightGroup {
  date: string;
  events: DasEventSnapshot[];
}

export interface DasMigrationPlan {
  plans: DasEventPlan[];
  /** Separate events on one night in different rooms — possibly one club night; never merged automatically. */
  sameNightGroups: SameNightGroup[];
  counts: { reviewed: number; update: number; unchanged: number; unresolved: number };
}

const STRUCTURED_FIELDS = ["title", "description", "artists"] as const;

export function planEvent(event: DasEventSnapshot): DasEventPlan {
  const onSmallRoomVenue = event.venueId !== DEN_ANDEN_SIDE_VENUE_ID;
  const s = structureDenAndenSideRooms({
    title: event.title,
    description: event.description,
    artists: event.artists,
    venueName: onSmallRoomVenue ? SMALL_ROOM : event.venueName,
  });

  const patch: DasEventPlan["patch"] = {};
  if (s.title !== event.title) patch.title = s.title;
  if (s.description !== event.description) patch.description = s.description;
  if (s.artists.length !== event.artists.length || s.artists.some((a, i) => a !== event.artists[i])) patch.artists = s.artists;
  if (onSmallRoomVenue) patch.venueId = DEN_ANDEN_SIDE_VENUE_ID;

  const base = { event, verdict: s.analysis.verdict, reason: s.analysis.reason };

  if (s.analysis.verdict === "unresolved") {
    // The venue move needs no room evidence and is always safe on its own.
    return onSmallRoomVenue
      ? { ...base, outcome: "update", patch: { venueId: DEN_ANDEN_SIDE_VENUE_ID }, reason: `${s.analysis.reason} (venue moved only; room split needs manual review)` }
      : { ...base, outcome: "unresolved", patch: {} };
  }

  const locked = STRUCTURED_FIELDS.filter((f) => f in patch && event.overriddenFields.includes(f));
  if (locked.length > 0) {
    return {
      ...base,
      outcome: "unresolved",
      reason: `room split verified (${s.analysis.verdict}), but ${locked.join(", ")} ${locked.length > 1 ? "were" : "was"} edited by an admin — not overwritten; review manually`,
      patch: onSmallRoomVenue ? { venueId: DEN_ANDEN_SIDE_VENUE_ID } : {},
    };
  }

  return { ...base, outcome: Object.keys(patch).length > 0 ? "update" : "unchanged", patch };
}

function copenhagenDate(iso: string): string {
  const p = getCopenhagenParts(new Date(iso));
  // A club night starting after midnight belongs to the evening before.
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - (p.hour < 8 ? 1 : 0)));
  return d.toISOString().slice(0, 10);
}

export function planDenAndenSideMigration(events: DasEventSnapshot[]): DasMigrationPlan {
  const plans = events.map(planEvent);

  // Nights with more than one live event, where one sits in the small room
  // and another does not: RA lists such rooms as separate events with their
  // own tickets, so they are only flagged, never merged.
  const byNight = new Map<string, DasEventSnapshot[]>();
  for (const p of plans) {
    if (p.event.cancelled) continue;
    const key = copenhagenDate(p.event.startDatetime);
    byNight.set(key, [...(byNight.get(key) ?? []), p.event]);
  }
  const sameNightGroups: SameNightGroup[] = [];
  for (const [date, group] of byNight) {
    if (group.length < 2) continue;
    const roomOf = (e: DasEventSnapshot) => plans.find((p) => p.event.id === e.id)!;
    const small = group.some((e) => roomOf(e).verdict === "small-room-only");
    const other = group.some((e) => roomOf(e).verdict !== "small-room-only");
    if (small && other) sameNightGroups.push({ date, events: group });
  }
  sameNightGroups.sort((a, b) => a.date.localeCompare(b.date));

  const counts = {
    reviewed: plans.length,
    update: plans.filter((p) => p.outcome === "update").length,
    unchanged: plans.filter((p) => p.outcome === "unchanged").length,
    unresolved: plans.filter((p) => p.outcome === "unresolved").length,
  };
  return { plans, sameNightGroups, counts };
}
