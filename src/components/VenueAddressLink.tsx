import { googleMapsUrl } from "@/lib/data/venues";

function MapPinIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
      <path d="M10 18s6-5.686 6-10a6 6 0 1 0-12 0c0 4.314 6 10 6 10Z" strokeLinejoin="round" />
      <circle cx="10" cy="8" r="2" />
    </svg>
  );
}

/**
 * Clickable venue address linking out to a keyless Google Maps search —
 * reused on the venue directory, venue detail, and event detail pages.
 * Renders nothing for a missing/blank address rather than a broken map
 * link: `venues.address` is NOT NULL in the schema, but this stays
 * defensive since a blank string would otherwise still pass that check.
 */
export default function VenueAddressLink({ address, className = "" }: { address: string; className?: string }) {
  const trimmed = address.trim();
  if (!trimmed) return null;
  return (
    <a
      href={googleMapsUrl(trimmed)}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 hover:text-text-primary hover:underline focus-visible:underline active:underline ${className}`}
    >
      <MapPinIcon />
      {trimmed}
      <span className="sr-only"> (opens Google Maps in a new tab)</span>
    </a>
  );
}
