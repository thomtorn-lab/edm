/**
 * Which venues each official source has authority over (ticket-replacement
 * shadow mode, 2026-10-18). An official venue's own page is authoritative
 * for its own events only; a promoter brand for the venues it runs nights
 * at. Static code registry, deliberately explicit: a source not listed here
 * has authority over no venue, so it can never be the reason an existing
 * ticket link would be replaced. Read only by the read-only shadow report
 * (src/lib/ticketReplacementShadow.ts); no sync path consults it.
 */
export const OFFICIAL_SOURCE_VENUES: Readonly<Record<string, readonly string[]>> = {
  "src-culture-box": ["v-culture-box"],
  "src-hangaren": ["v-hangaren"],
  "src-pumpehuset": ["v-pumpehuset"],
  "src-poolen": ["v-poolen"],
  "src-alice": ["v-alice"],
  "src-pylonen": ["v-pylonen"],
  // Gravity is a promoter brand renting TAP1's room (see gravityAdapter.ts).
  "src-gravity": ["v-gravity", "v-tap1"],
};

export function sourceHasVenueAuthority(sourceId: string, venueId: string | null): boolean {
  if (!venueId) return false;
  return OFFICIAL_SOURCE_VENUES[sourceId]?.includes(venueId) ?? false;
}
