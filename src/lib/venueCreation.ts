import { normalizeVenueName, resolveVenue } from "./normalize";
import type { Venue } from "./types";

/**
 * Pure decision logic for admin-driven venue creation (source onboarding
 * follow-up: closing the runtime venue-creation gap). Kept separate from
 * src/db/writes.ts, which has no unit tests of its own (validated instead
 * via live Preview-sync runs — see src/db/sync.test.ts's header comment) —
 * every actual product decision here (duplicate prevention, the Byhaven /
 * Black Box / Red Box guard, slug generation) is pure and testable without a
 * database.
 */

export interface NewVenueInput {
  name: string;
  address: string;
  city: "Copenhagen" | "Frederiksberg";
  postalCode: string;
  websiteUrl?: string | null;
}

export type VenueCreationPlan =
  | { kind: "existing"; venue: Venue }
  | { kind: "needs-confirmation"; reason: string }
  | { kind: "create"; venue: Venue };

/**
 * Known sub-areas/rooms of an existing first-party venue whose raw source
 * text looks exactly like a venue name but must never silently become a
 * standalone venue identity: Byhaven is Pumpehuset's own pop-up area (see
 * subVenueLabel() in eventPresentation.ts), Black Box / Red Box are Culture
 * Box's two rooms, consolidated into one canonical event per night. A
 * genuinely different venue that happens to share one of these names can
 * still be created — this only requires an explicit, separate confirmation
 * rather than the normal one-step create.
 */
const PROTECTED_SUB_VENUE_NAMES = new Set(["byhaven", "black box", "red box"].map(normalizeVenueName));

export function isProtectedSubVenueName(name: string): boolean {
  return PROTECTED_SUB_VENUE_NAMES.has(normalizeVenueName(name));
}

/**
 * Deterministic, ASCII-only slug from a venue name — same shape as the
 * curated seed fixtures ("den-anden-side", "vega-ideal-bar"). Diacritics
 * that don't decompose under NFKD (æ/ø/å) fall out as hyphens rather than
 * being transliterated — acceptable for a URL segment, not shown as prose.
 */
export function slugifyVenueName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Decides what admin-driven venue creation should actually do, given the
 * current venue registry. Never mutates anything — src/db/writes.ts's
 * createVenue() is the thin, DB-touching wrapper around this.
 *
 * Order of checks matters: an exact normalized match against an EXISTING
 * venue (including one of the protected sub-venue names, if it happens to
 * already be registered under that exact name) always wins over the guard —
 * there is nothing unsafe about reusing a venue that's already real. The
 * guard only fires for a genuinely NEW row that isn't confirmed.
 */
export function planVenueCreation(
  input: NewVenueInput,
  existingVenues: Venue[],
  options: { confirmed?: boolean } = {},
): VenueCreationPlan {
  const existing = resolveVenue(input.name, existingVenues);
  if (existing) return { kind: "existing", venue: existing };

  if (isProtectedSubVenueName(input.name) && !options.confirmed) {
    return {
      kind: "needs-confirmation",
      reason:
        `"${input.name.trim()}" is normally a sub-area/room of an existing venue, not a standalone venue ` +
        "(Byhaven is part of Pumpehuset; Black Box/Red Box are Culture Box's rooms). " +
        "Confirm explicitly if this is genuinely a different venue.",
    };
  }

  const slug = slugifyVenueName(input.name);
  const venue: Venue = {
    id: `v-${slug}`,
    slug,
    name: input.name.trim(),
    aliases: [],
    address: input.address.trim(),
    city: input.city,
    postalCode: input.postalCode.trim(),
    websiteUrl: input.websiteUrl?.trim() || null,
    // Non-null per schema, but never fabricated — empty until an editorial
    // pass gives this (initially non-curated) venue real copy.
    description: "",
    shortDescription: null,
    venueProfile: null,
  };
  return { kind: "create", venue };
}
