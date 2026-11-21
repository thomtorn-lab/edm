import type { GenreSlug } from "./taxonomy";

/**
 * The contract between GET /api/v1/events and the iPhone app (PR #231, mobile/),
 * which imports this file for its types. Kept free of runtime imports so the
 * app never pulls in server code.
 *
 * Every field is produced by the same presentation helpers the website's
 * EventRow and event page use (see the route), so titles, lineup names,
 * link labels/order and status badges match the site. Date/time labels and
 * the Tonight/Weekend/genre filters are computed in the app from the shared
 * src/lib/datetime.ts, format.ts and taxonomy.ts, because they depend on the
 * device's current time.
 */
export interface AppEvent {
  id: string;
  slug: string;
  /** Public web page, used for sharing. */
  url: string;
  title: string;
  subVenue: string | null;
  lineup: string[];
  startDatetime: string;
  endDatetime: string | null;
  venue: { id: string; name: string; address: string };
  subgenres: GenreSlug[];
  /** Status badge labels ("Postponed", "Sold out"), as on the site. */
  statuses: string[];
  /** Site link order and labels ("Official event", "Tickets", …); `primary` as in getExternalLinks. */
  links: { label: string; href: string; primary: boolean }[];
  /** Free admission, shown instead of a ticket link (showFreeCta). */
  free: boolean;
}

export interface AppEventsResponse {
  events: AppEvent[];
}
