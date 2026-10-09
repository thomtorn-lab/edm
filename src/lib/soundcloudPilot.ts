/**
 * One-event SoundCloud UX pilot (2026-10-09) — deliberately NOT a general
 * SoundCloud integration. There is no artist-matching system, no database
 * table, and no automatic discovery: exactly one hand-picked, real upcoming
 * published event gets a SOUNDCLOUD pill + a compact links section, so the
 * actual experience can be evaluated before any broader rollout is
 * considered. See this module's own small export surface — every call site
 * that wants to show SoundCloud content must go through
 * `getSoundcloudPilotArtists`, which is scoped by event id AND cross-checked
 * against that event's own current lineup, so nothing here can ever leak
 * onto a different event even if IDs were somehow reused.
 *
 * Every URL below was manually, individually verified against multiple
 * independent sources (not matched by artist name alone, per the pilot's
 * own explicit constraint) before being hardcoded here:
 *   - Tim Andresen (soundcloud.com/tim-andresen): corroborated by a Shotgun
 *     event listing pairing this exact SoundCloud URL with his Instagram
 *     and his "Copenhagen Culture Box" billing, by his own Bandsintown
 *     artist page, and by his Resident Advisor profile — consistent across
 *     all three with his real biography (Culture Box co-owner/resident DJ
 *     since 2005, What Happens label/night founder).
 *   - Rexie Lex (soundcloud.com/rexie_lex): the profile's own bio
 *     self-identifies as a Copenhagen DJ, explicitly lists Culture Box among
 *     her past venues, names deep house/tech house/melodic techno as her
 *     sound (matching this pilot event's own genre tags), and includes an
 *     uploaded Culture Box set.
 */
export const SOUNDCLOUD_PILOT_EVENT_ID = "e-bf9d6551";

interface PilotArtist {
  /** Exact lineup display name this entry is scoped to (case-sensitive match against the event's own `artists` array) — never a fuzzy/partial match. */
  name: string;
  url: string;
}

const PILOT_ARTISTS: readonly PilotArtist[] = [
  { name: "TIM ANDRESEN", url: "https://soundcloud.com/tim-andresen" },
  { name: "REXIE LEX", url: "https://soundcloud.com/rexie_lex" },
];

/**
 * Returns the verified SoundCloud links for `eventId`'s own current
 * lineup, or an empty array for every other event (including a future
 * resync of the pilot event whose lineup no longer contains these exact
 * names — this never falls back to showing a stale/mismatched link).
 */
export function getSoundcloudPilotArtists(eventId: string, lineupArtists: string[]): PilotArtist[] {
  if (eventId !== SOUNDCLOUD_PILOT_EVENT_ID) return [];
  const lineupSet = new Set(lineupArtists);
  return PILOT_ARTISTS.filter((a) => lineupSet.has(a.name));
}

/** Whether `eventId` is the one pilot event the SOUNDCLOUD pill may ever render for — the single gate both EventRow and the event-detail page use. */
export function isSoundcloudPilotEvent(eventId: string): boolean {
  return eventId === SOUNDCLOUD_PILOT_EVENT_ID;
}
