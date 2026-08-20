import type { EventRecord } from "./types";

export interface ExternalLink {
  label: string;
  href: string;
  primary: boolean;
}

/**
 * External destinations for an event, deduplicated by URL and ordered by
 * authority (spec section 12) — official first with the strongest CTA
 * treatment, then tickets, then secondary references. If two roles point to
 * the same URL, only the higher-priority label is kept.
 */
export function getExternalLinks(event: EventRecord, max?: number): ExternalLink[] {
  const seen = new Set<string>();
  const links: ExternalLink[] = [];

  const add = (label: string, href: string | null, primary = false) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    links.push({ label, href, primary });
  };

  add("Official event", event.officialEventUrl, true);
  add("Tickets", event.ticketUrl);
  // Provider-agnostic CTA (spec section 12): when no dedicated ticketUrl
  // exists, the Resident Advisor link *is* the ticket destination, so it
  // must read "Tickets" too rather than leaking the provider's name.
  add(event.ticketUrl ? "Resident Advisor" : "Tickets", event.residentAdvisorUrl);
  add("Facebook", event.facebookUrl);
  for (const url of event.otherSourceUrls) add("Source", url);

  return typeof max === "number" ? links.slice(0, max) : links;
}
