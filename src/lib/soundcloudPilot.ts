import { dateKeyToString, nightlifeDateKey } from "./datetime";
import type { EventRecord } from "./types";

/**
 * SoundCloud artist-link pilot — deliberately NOT a general SoundCloud
 * integration. There is no artist-matching system, no database table, no
 * API call and no automatic discovery: a short, hand-reviewed list of
 * verified profiles, each bound to the exact evidence that supports it.
 *
 * History:
 *   - 2026-10-09: one hand-picked event (Culture Box New Year's Eve,
 *     SOUNDCLOUD_PILOT_EVENT_ID) with two verified artists.
 *   - 2026-10-13 (Phase 1 expansion): the same verified links on the other
 *     published Culture Box nights where Culture Box's own events page
 *     (culture-box.com/events/) links that exact lineup name to that exact
 *     profile, plus five newly verified artists.
 *
 * Every entry is scoped to (source, Copenhagen nightlife date, exact lineup
 * name) — never a global name match. An entry only applies to an event
 * whose canonical source is Culture Box, on one of the nights listed for it,
 * whose own lineup contains the name exactly (case-sensitive, as the venue
 * bills it). A same-named act on another venue's event, on a Culture Box
 * night not listed here, or after a lineup change, gets nothing. Anything
 * that fails a check abstains — there is no fallback.
 *
 * Acceptance bar for an entry (never artist-name similarity alone):
 *   1. Culture Box's own events page pairs this exact lineup name with this
 *      exact profile URL on every listed night (one consistent URL; a name
 *      linked to two different URLs is a conflict and is excluded).
 *   2. The URL is an artist profile (soundcloud.com/<handle>), not a track,
 *      podcast episode, or a label/venue account.
 *   3. At least one independent source corroborates the same handle and
 *      identity.
 *
 * Evidence (Culture Box events page re-checked 2026-10-13):
 *   - Tim Andresen (tim-andresen): Shotgun listing pairing this URL with his
 *     Instagram and Culture Box billing, his Bandsintown page and his RA
 *     profile (Culture Box co-owner/resident since 2005).
 *   - Rexie Lex (rexie_lex): the profile's own bio — Copenhagen DJ, Culture
 *     Box among past venues, uploaded Culture Box set.
 *   - Kevin Di Serna (kevindiserna): RA dj/kevindiserna, Bandcamp
 *     kevindiserna; profile identifies the Argentine DJ/producer
 *     (Innervisions/Sudbeat releases, sets with Hernán Cattaneo).
 *   - Sarah Wild (wildsarah): profile identifies the Berlin DJ/producer
 *     (Midnight Operators label, Garbicz/Fusion sets), matching her RA
 *     profile and press.
 *   - Dusky (duskymusic): Shotgun artist page "duskymusic" and event
 *     listings pairing this URL with duskymusic.com (London duo).
 *   - Guy J (guy-j): Ibiza Spotlight and a Balance Selections Q&A both list
 *     this URL for Guy Judah (Lost & Found / Bedrock).
 *   - Anders HP (anders_hp): RA dj/andershp (Copenhagen; Culture Box,
 *     Module, Klub Werkstatt) and a profile of Module/Karrusel sets.
 *
 * Deliberately excluded for now (uncertain or abstained, see the pilot
 * investigation): e.g. Culture Box links that point at a label account
 * (Chich, Emok), a podcast episode (Galatius), conflicting URLs (Rós), a
 * generic name (NAT), or an opaque handle with no corroboration.
 *
 * To take a link down, remove its entry (or one of its nights) here — this
 * list is the only switch.
 */
export const SOUNDCLOUD_PILOT_EVENT_ID = "e-bf9d6551";

/** Matches CULTURE_BOX_SOURCE_ID in src/lib/adapters/cultureBoxAdapter.ts (asserted in soundcloudPilot.test.ts) — not imported, to keep adapter code out of the UI bundle. */
export const SOUNDCLOUD_PILOT_SOURCE_ID = "src-culture-box";

interface PilotArtist {
  /** Exact lineup display name this entry is scoped to (case-sensitive match against the event's own `artists` array) — never a fuzzy/partial match. */
  name: string;
  url: string;
}

interface PilotEntry extends PilotArtist {
  /** Culture Box nights (Copenhagen nightlife date, YYYY-MM-DD) on which the venue's own events page links `name` to `url`. */
  nights: readonly string[];
}

const PILOT_ENTRIES: readonly PilotEntry[] = [
  {
    name: "TIM ANDRESEN",
    url: "https://soundcloud.com/tim-andresen",
    nights: ["2026-10-17", "2026-10-31", "2026-11-21", "2026-12-11", "2026-12-31"],
  },
  { name: "REXIE LEX", url: "https://soundcloud.com/rexie_lex", nights: ["2026-10-31", "2026-12-31"] },
  { name: "KEVIN DI SERNA", url: "https://soundcloud.com/kevindiserna", nights: ["2026-10-17"] },
  { name: "ANDERS HP", url: "https://soundcloud.com/anders_hp", nights: ["2026-10-23"] },
  { name: "SARAH WILD", url: "https://soundcloud.com/wildsarah", nights: ["2026-11-06"] },
  { name: "DUSKY", url: "https://soundcloud.com/duskymusic", nights: ["2026-11-13"] },
  { name: "GUY J", url: "https://soundcloud.com/guy-j", nights: ["2026-11-21"] },
];

/** The original one-event pilot's artists — always shown on that event when its lineup still contains them, exactly as before the expansion. */
const ORIGINAL_PILOT_NAMES = new Set(["TIM ANDRESEN", "REXIE LEX"]);

type PilotEvent = Pick<EventRecord, "id" | "artists" | "startDatetime" | "canonicalSourceId">;

/**
 * Returns the verified SoundCloud links for `event`'s own current lineup,
 * in lineup order, or an empty array whenever any scope check fails (not a
 * Culture Box event, not a listed night, name not in the lineup exactly).
 */
export function getSoundcloudPilotArtists(event: PilotEvent): PilotArtist[] {
  const isOriginalPilotEvent = event.id === SOUNDCLOUD_PILOT_EVENT_ID;
  const isPilotSource = event.canonicalSourceId === SOUNDCLOUD_PILOT_SOURCE_ID;
  if (!isOriginalPilotEvent && !isPilotSource) return [];
  const night = isPilotSource ? dateKeyToString(nightlifeDateKey(new Date(event.startDatetime))) : null;
  const result: PilotArtist[] = [];
  const seen = new Set<string>();
  for (const name of event.artists) {
    if (seen.has(name)) continue;
    const entry = PILOT_ENTRIES.find((e) => e.name === name);
    if (!entry) continue;
    const onListedNight = night !== null && entry.nights.includes(night);
    const onOriginalPilotEvent = isOriginalPilotEvent && ORIGINAL_PILOT_NAMES.has(name);
    if (!onListedNight && !onOriginalPilotEvent) continue;
    seen.add(name);
    result.push({ name: entry.name, url: entry.url });
  }
  return result;
}
