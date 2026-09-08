import type { EventRecord, Source } from "./types";
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
function classifySourceRole(sourceType: Source["sourceType"]): "official" | "tickets" | "unknown" {
  if (sourceType === "ticketing") return "tickets";
  if (sourceType === "official-venue" || sourceType === "official-promoter") return "official";
  return "unknown";
}

/**
 * Manual-override precedence (admin + public link integrity, 2026-09-08):
 * once an admin has explicitly set/edited `officialEventUrl` (tracked in
 * `overriddenFields`, the same mechanism every other hand-corrected field
 * already uses — src/lib/override.ts), that URL is a deliberate editorial
 * decision, not source-derived data — it must always render "Official
 * event" regardless of what the event's canonicalSourceId's sourceType
 * would otherwise infer. Without this, an event whose canonical source is
 * a discovery/aggregator source (e.g. KultuNaut, sourceType
 * general-aggregator) permanently downgrades ANY officialEventUrl to
 * "Source" — including a real official venue URL an admin typed in by
 * hand — and, worse, that "Source"-labeled entry then gets silently
 * stripped out entirely by getExternalLinks whenever the same event also
 * has a Tickets/RA link, i.e. the admin's Official Event link visibly
 * "disappears" from the public page. Source-role inference below still
 * applies to every URL an admin has NOT touched (unchanged from before).
 */
function officialUrlRole(
  event: Pick<EventRecord, "canonicalSourceId" | "overriddenFields">,
): "official" | "tickets" | "unknown" {
  if (event.overriddenFields.includes("officialEventUrl")) return "official";
  if (!event.canonicalSourceId) return "official";
  const source = getSourceById(event.canonicalSourceId);
  if (!source) return "official";
  return classifySourceRole(source.sourceType);
}

/**
 * External destinations for an event, deduplicated by URL and ordered by
 * authority (spec section 12) — official first with the strongest CTA
 * treatment, then tickets, then secondary references. If two roles point to
 * the same URL, only the correctly-classified label is kept (see
 * officialUrlRole above) — never both, and never "Official event" merely
 * because it was checked first.
 *
 * Source-CTA visibility (public source-link visibility work package,
 * 2026-09-07): a "Source" entry (a discovery/aggregator link with no
 * first-party or ticketing standing over this event — see officialUrlRole
 * above, and any admin-merged `otherSourceUrls`) is a CTA of last resort,
 * never an equal alternative next to a genuine Official event/Tickets
 * destination. Once "Official event", "Tickets" or "Resident Advisor" is
 * present in the list, every "Source" entry is dropped before this function
 * returns (and before `max` truncates) — Source is shown as a CTA only when
 * it's the sole usable public link (spec section 2, rule D). This applies
 * identically wherever this function is called (event cards and the detail
 * page share this one helper — see getSourceProvenance below for the
 * separate, detail-page-only, non-CTA provenance treatment).
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
  // Facebook decision (unified event create/edit model, 2026-09-08): Facebook
  // is no longer a distinct public link role — it was previously always its
  // own separate "Facebook" CTA, never suppressed by the primary-destination
  // rule below, so a Facebook-sourced event could show three CTAs (Official
  // event/Tickets AND Facebook) at once. A Facebook URL is only ever the
  // event's Official event destination now, and only rendered as one when
  // officialEventUrl itself is unset — if officialEventUrl is already
  // populated (the common case), a distinct legacy facebookUrl is presentation-
  // suppressed as redundant rather than shown a third time. Read-path only;
  // no data mutation — see EventManager.tsx's "Legacy Facebook URL" field for
  // where a genuinely distinct historical value stays editable.
  if (!event.officialEventUrl && event.facebookUrl) {
    add("Official event", event.facebookUrl, true);
  }
  for (const url of event.otherSourceUrls) add("Source", url);

  const hasPrimaryDestination = links.some((l) => l.label === "Official event" || l.label === "Tickets" || l.label === "Resident Advisor");
  const ctaLinks = hasPrimaryDestination ? links.filter((l) => l.label !== "Source") : links;

  return typeof max === "number" ? ctaLinks.slice(0, max) : ctaLinks;
}

/** One row of `source_event_links` as needed by getSourceProvenance below — never the full table shape (no firstSeenAt/trust/etc). */
export interface SourceLinkForProvenance {
  sourceId: string;
  sourceUrl: string;
  /** Which URL kind this row recorded ("official" | "ticket" | "facebook" | "resident-advisor" | "other") — used only to prefer a source's "official" row as its representative link when it has more than one. */
  role: string;
}

export interface SourceProvenanceEntry {
  sourceName: string;
  sourceUrl: string;
}

/**
 * Discreet, non-CTA public provenance for the event DETAIL PAGE only (public
 * source-link visibility work package, 2026-09-07; revised same day —
 * canonical-source-only was too narrow, see below) — never wired into event
 * cards/homepage (see getExternalLinks's own doc comment).
 *
 * Derived from the event's ACTUAL `source_event_links` rows, not merely its
 * canonicalSourceId: createEvent/publishDiscoveryItem already record a
 * source_event_links row for the canonical source itself the moment an
 * event is created (see db/writes.ts), so passing the event's full link set
 * here covers the canonical source too — no separate canonicalSourceId
 * special-case is needed. This matters because a canonical official-venue/
 * ticketing event (which renders its own Official event/Tickets CTA) can
 * still carry a SECOND, non-canonical discovery match worth disclosing —
 * confirmed live: 13 published events, each a KultuNaut discovery match
 * layered onto an already-canonical Poolen/Pumpehuset event via db/sync.ts's
 * recordSourceLink (called for any source whose sync candidate matches an
 * existing event, not only the canonical one) — the earlier canonical-only
 * design silently dropped exactly these.
 *
 * Only sources whose sourceType is NOT official-venue/official-promoter/
 * ticketing are surfaced (classifySourceRole !== "unknown" is excluded) —
 * those already render as Official event/Tickets, so repeating them here
 * would be redundant. One entry per distinct qualifying source (its
 * "official"-role row preferred when more than one URL kind was recorded
 * for it), sorted by display name for a stable, deterministic public order
 * regardless of query row order. Never a source id, trust level, or
 * ingestion/pipeline internal — `sourceName` here is `Source.publicName` (a
 * clean public brand name, e.g. "KultuNaut"), never the internal registry
 * `sourceName`, which can carry feed-specific detail like "KultuNaut —
 * Elektronisk / Club-DJ (Kbh. og Frederiksberg)" that must never reach the
 * public page. Full multi-source history remains available in admin/
 * diagnostics regardless (source_event_links itself is never mutated by
 * this presentation-only function).
 */
export function getSourceProvenance(links: SourceLinkForProvenance[]): SourceProvenanceEntry[] {
  const bySource = new Map<string, SourceLinkForProvenance>();
  for (const link of links) {
    const existing = bySource.get(link.sourceId);
    if (!existing || (existing.role !== "official" && link.role === "official")) {
      bySource.set(link.sourceId, link);
    }
  }

  const entries: SourceProvenanceEntry[] = [];
  for (const link of bySource.values()) {
    const source = getSourceById(link.sourceId);
    if (!source) continue;
    if (classifySourceRole(source.sourceType) !== "unknown") continue;
    entries.push({ sourceName: source.publicName ?? source.sourceName, sourceUrl: link.sourceUrl });
  }
  entries.sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  return entries;
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
