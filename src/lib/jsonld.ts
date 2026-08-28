import type { EventWithVenue } from "./queries";

/**
 * schema.org Event structured data. Deliberately mirrors only what's
 * rendered on the page (spec section 52) — no invented fields.
 */
export function buildEventJsonLd(event: EventWithVenue, canonicalUrl: string) {
  const offers =
    event.ticketUrl || event.priceFrom != null
      ? {
          "@type": "Offer",
          url: event.ticketUrl ?? event.officialEventUrl ?? canonicalUrl,
          price: event.priceFrom ?? undefined,
          priceCurrency: event.currency ?? "DKK",
          availability: event.soldOut
            ? "https://schema.org/SoldOut"
            : "https://schema.org/InStock",
        }
      : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: event.title,
    startDate: event.startDatetime,
    endDate: event.endDatetime ?? undefined,
    // Mirrors StatusBadge's own public-status precedence (event
    // lifecycle/status handling, 2026-08-28): cancelled first, then
    // postponed, then a confirmed reschedule (dateChanged only — a bare
    // timeChanged is an internal same-day correction, not a reschedule
    // worth structured data either).
    eventStatus: event.cancelled
      ? "https://schema.org/EventCancelled"
      : event.postponed
        ? "https://schema.org/EventPostponed"
        : event.dateChanged
          ? "https://schema.org/EventRescheduled"
          : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: event.venue.name,
      address: {
        "@type": "PostalAddress",
        streetAddress: event.venue.address,
        addressLocality: event.venue.city,
        addressCountry: "DK",
      },
    },
    performer: event.artists.map((name) => ({ "@type": "PerformingGroup", name })),
    description: event.description ?? undefined,
    image: event.imageUrl ?? undefined,
    url: canonicalUrl,
    offers,
  };
}
