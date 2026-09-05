import type { EventRecord } from "./types";
import { getSourceById } from "./data/sources";
import { normalizeUrl } from "./dedup";

export interface ExternalLink {
  label: string;
  href: string;
  primary: boolean;
}

/**
 * Event-link role classification (public event-integrity follow-up,
 * 2026-09-05 — Zoumer reference case): a URL's role must come from the
 * DESTINATION'S FUNCTION, not merely from which field happened to hold it.
 * `officialEventUrl` was previously always labeled "Official event" no
 * matter what supplied it — for a ticketing-marketplace source (Billetto:
 * its own event page IS simultaneously the "official" record and the
 * ticket-purchase page from that source's point of view, so its adapter
 * historically set both fields to the same URL) this overclaims a first-
 * party status the source never had. The event's own canonical source's
 * `sourceType` is already-modeled, structural evidence for this (see
 * SOURCE_TYPE_PRIORITY/resolveByCanonicalPriority in classification.ts) —
 * not a per-event or per-domain guess:
 *   - official-venue / official-promoter: a genuine first-party page — keep
 *     "Official event", even if that same page also sells tickets.
 *   - ticketing: never a first-party record — relabel "Tickets".
 *   - specialist-aggregator / general-aggregator / social: no first-party
 *     standing over this specific event either — relabel "Source" (spec
 *     section 2's SOURCE/DISCOVERY role: exists only because it's where
 *     this event was found, must never be promoted to "Official event").
 *   - no canonicalSourceId (admin-added) or an unresolvable id: unchanged —
 *     a human already vouched for this URL, or there's no contradicting
 *     evidence to justify downgrading what's already stored.
 */
function officialUrlRole(event: Pick<EventRecord, "canonicalSourceId">): "official" | "tickets" | "unknown" {
  if (!event.canonicalSourceId) return "official";
  const source = getSourceById(event.canonicalSourceId);
  if (!source) return "official";
  if (source.sourceType === "ticketing") return "tickets";
  if (source.sourceType === "official-venue" || source.sourceType === "official-promoter") return "official";
  return "unknown";
}

/**
 * External destinations for an event, deduplicated by URL and ordered by
 * authority (spec section 12) — official first with the strongest CTA
 * treatment, then tickets, then secondary references. If two roles point to
 * the same URL, only the correctly-classified label is kept (see
 * officialUrlRole above) — never both, and never "Official event" merely
 * because it was checked first.
 */
export function getExternalLinks(event: EventRecord, max?: number): ExternalLink[] {
  const seen = new Set<string>();
  const links: ExternalLink[] = [];

  const add = (label: string, href: string | null, primary = false) => {
    if (!href) return;
    // Normalized for the collision check only (spec section 3: "resolve to
    // the same normalized URL") — utm_* and other tracking params must not
    // make two links to the identical destination look distinct; the
    // ORIGINAL href (with any tracking params intact) is still what's
    // stored/rendered.
    const key = normalizeUrl(href) ?? href;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ label, href, primary });
  };

  if (event.officialEventUrl) {
    const role = officialUrlRole(event);
    add(role === "tickets" ? "Tickets" : role === "unknown" ? "Source" : "Official event", event.officialEventUrl, true);
  }
  // Whichever label the block above used, `add`'s own seen-set collapses an
  // identical ticketUrl into that single entry rather than a duplicate.
  add("Tickets", event.ticketUrl);
  // Provider-agnostic CTA (spec section 12): when no dedicated ticketUrl
  // exists, the Resident Advisor link *is* the ticket destination, so it
  // must read "Tickets" too rather than leaking the provider's name.
  add(event.ticketUrl ? "Resident Advisor" : "Tickets", event.residentAdvisorUrl);
  add("Facebook", event.facebookUrl);
  for (const url of event.otherSourceUrls) add("Source", url);

  return typeof max === "number" ? links.slice(0, max) : links;
}

/**
 * True only when the event has a real ticket-purchase destination
 * (ticketUrl, or a Resident Advisor link standing in for one) — the same
 * two fields that produce the "Tickets" label above.
 */
export function hasTicketDestination(event: Pick<EventRecord, "ticketUrl" | "residentAdvisorUrl">): boolean {
  return Boolean(event.ticketUrl || event.residentAdvisorUrl);
}

/**
 * Free-admission evidence must be positive and explicit, never inferred from
 * a merely-absent ticket link. `priceFrom === 0` is only ever set by an
 * adapter when the source's own text states free admission (e.g.
 * pumpehusetAdapter's "fri entré" match) — a missing/unknown price is always
 * stored as `null`, never defaulted to 0 — so this is real evidence, not a
 * guess.
 */
export function isFreeAdmission(event: Pick<EventRecord, "priceFrom">): boolean {
  return event.priceFrom === 0;
}

/** Whether the FREE CTA should be shown in place of a Tickets link. */
export function showFreeCta(event: Pick<EventRecord, "ticketUrl" | "residentAdvisorUrl" | "priceFrom">): boolean {
  return !hasTicketDestination(event) && isFreeAdmission(event);
}
