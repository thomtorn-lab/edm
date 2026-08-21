/**
 * One-time, Culture-Box-specific transition logic (partner-ready polish
 * pass): before the room-consolidated adapter (src/lib/adapters/
 * cultureBoxAdapter.ts) went live, every Culture Box night that cleared the
 * quality gate for BOTH its rooms was published as two separate canonical
 * events (one per room), linked by a shared base officialEventUrl with a
 * different #black-box/#red-box fragment. Going forward the adapter emits
 * ONE consolidated candidate per night — this module finds any night still
 * represented by such a pair and computes the single patch that merges them,
 * so a narrow one-time DB script (src/db/cultureBoxRoomConsolidation.ts) can
 * apply it without a general rooms/stages architecture and without touching
 * dedup.ts/pipeline.ts.
 *
 * Deliberately conservative: a pair is only ever found when EVERY signal
 * agrees (same venue, same exact start instant, same base official URL with
 * differing room fragments, explicit "Black Box"/"Red Box" room identity in
 * both titles) and neither side has an admin hand-edit or a cancelled flag —
 * anything less than that is left alone for a human to look at, never
 * guessed.
 */

export interface CultureBoxEventSnapshot {
  id: string;
  title: string;
  description: string | null;
  artists: string[];
  venueId: string;
  startDatetime: string;
  officialEventUrl: string | null;
  ticketUrl: string | null;
  residentAdvisorUrl: string | null;
  facebookUrl: string | null;
  imageUrl: string | null;
  priceFrom: number | null;
  published: boolean;
  cancelled: boolean;
  manualOverride: boolean;
  overriddenFields: string[];
}

export interface RoomPair {
  survivor: CultureBoxEventSnapshot;
  obsolete: CultureBoxEventSnapshot;
  reason: string;
}

const ROOM_NAME_RE = /^(Black Box|Red Box)\b/i;

function roomName(title: string): "Black Box" | "Red Box" | null {
  const m = title.match(ROOM_NAME_RE);
  if (!m) return null;
  return /black/i.test(m[1]) ? "Black Box" : "Red Box";
}

function baseUrl(url: string | null): string | null {
  if (!url) return null;
  const [base] = url.split("#");
  return base || null;
}

/**
 * Finds every currently-published Black Box/Red Box pair representing one
 * shared night, using only strict, cross-checkable evidence. Each event can
 * belong to at most one pair. Survivor is always the "Black Box" side
 * (matching the new adapter's own room ordering) — the "Red Box" side is
 * the one that becomes obsolete.
 */
export function findCultureBoxRoomPairs(events: CultureBoxEventSnapshot[]): RoomPair[] {
  const pairs: RoomPair[] = [];
  const used = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const a = events[i];
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < events.length; j++) {
      const b = events[j];
      if (used.has(b.id)) continue;

      if (a.venueId !== b.venueId) continue;
      if (a.startDatetime !== b.startDatetime) continue;

      const aBase = baseUrl(a.officialEventUrl);
      const bBase = baseUrl(b.officialEventUrl);
      if (!aBase || !bBase || aBase !== bBase) continue;
      if (a.officialEventUrl === b.officialEventUrl) continue; // must actually differ by room fragment

      const aRoom = roomName(a.title);
      const bRoom = roomName(b.title);
      if (!aRoom || !bRoom || aRoom === bRoom) continue;

      if (!a.published || !b.published) continue;
      if (a.cancelled || b.cancelled) continue;
      if (a.manualOverride || b.manualOverride) continue;
      if (a.overriddenFields.length > 0 || b.overriddenFields.length > 0) continue;

      const survivor = aRoom === "Black Box" ? a : b;
      const obsolete = survivor === a ? b : a;
      pairs.push({
        survivor,
        obsolete,
        reason: `same venue/night, shared base URL (${aBase}), explicit Black Box/Red Box room identity in both titles, neither hand-edited or cancelled`,
      });
      used.add(a.id);
      used.add(b.id);
      break; // `a` is now spoken for — never matched against a second candidate
    }
  }

  return pairs;
}

export interface ConsolidationPatch {
  title: string;
  description: string;
  artists: string[];
  officialEventUrl: string;
  ticketUrl: string | null;
  residentAdvisorUrl: string | null;
  facebookUrl: string | null;
  imageUrl: string | null;
  priceFrom: number | null;
}

function roomLabel(title: string): string {
  return title.split(":")[0].trim();
}

function roomLineupBlock(event: CultureBoxEventSnapshot): string {
  const label = roomLabel(event.title);
  const lineup = event.artists.length > 0 ? event.artists.join(", ") : "Lineup TBA";
  return `${label}\n${lineup}`;
}

/**
 * Builds the single patch a room pair consolidates down to — the same
 * shape the room-consolidated adapter itself produces for a brand-new
 * night, so an already-published pair converges to the exact steady state
 * a first-time sync under the new adapter would have created. Genre fields
 * are deliberately left untouched (consolidation, not reclassification).
 */
export function buildConsolidationPatch(pair: RoomPair): ConsolidationPatch {
  const { survivor, obsolete } = pair;
  const title = `${survivor.title} · ${obsolete.title}`;
  const artists = [...survivor.artists, ...obsolete.artists];
  const roomBreakdown = `${roomLineupBlock(survivor)}\n\n${roomLineupBlock(obsolete)}`;
  const sharedProse = survivor.description ?? obsolete.description ?? null;
  const description = sharedProse ? `${sharedProse}\n\n${roomBreakdown}` : roomBreakdown;
  const officialEventUrl = baseUrl(survivor.officialEventUrl ?? obsolete.officialEventUrl) ?? "";

  return {
    title,
    description,
    artists,
    officialEventUrl,
    ticketUrl: survivor.ticketUrl ?? obsolete.ticketUrl,
    residentAdvisorUrl: survivor.residentAdvisorUrl ?? obsolete.residentAdvisorUrl,
    facebookUrl: survivor.facebookUrl ?? obsolete.facebookUrl,
    imageUrl: survivor.imageUrl ?? obsolete.imageUrl,
    priceFrom: survivor.priceFrom ?? obsolete.priceFrom,
  };
}
