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
    eventStatus: event.cancelled
      ? "https://schema.org/EventCancelled"
      : event.dateChanged || event.timeChanged
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
