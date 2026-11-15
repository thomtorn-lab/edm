/**
 * Official Event URL policy — HvadErPå ban (product rule, 2026-11-15).
 *
 * A hvaderpaa.dk URL may NEVER be stored in an event's Official Event URL
 * field (events.officialEventUrl, discoveryQueue.probableOfficialEventUrl,
 * RawCandidateEvent.officialEventUrl). HvadErPå is a discovery aggregator,
 * never the organizer, the venue or their own event listing. An event
 * imported from HvadErPå must carry an official link that points directly at
 * the organizer, the venue or their own event page; when no such link
 * exists the field stays empty. A missing Official Event URL never blocks
 * publishing or changes queue routing on its own.
 *
 * The HvadErPå page itself is still kept — as provenance only — in the
 * source's own source_event_links row and in discoveryQueue.sourceUrl, never
 * as an official link.
 *
 * Hostname-based (lowercased, "www." stripped, subdomains included), never a
 * substring check.
 */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isHvaderpaaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const h = hostnameOf(url);
  return h !== null && (h === "hvaderpaa.dk" || h.endsWith(".hvaderpaa.dk"));
}

/** Returns `url` unless it is banned from the Official Event URL field, in which case null. */
export function allowedOfficialEventUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return isHvaderpaaUrl(url) ? null : url;
}

/** Validation error shown when an admin tries to save a banned Official Event URL. */
export const HVADERPAA_OFFICIAL_URL_ERROR =
  "hvaderpaa.dk må aldrig bruges som Official event URL — brug arrangørens, venuets eller deres eget eventopslag, eller lad feltet stå tomt.";
