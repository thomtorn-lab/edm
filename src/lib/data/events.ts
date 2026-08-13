import type { ConfidenceLevel, EventRecord } from "../types";
import type { GenreSlug } from "../taxonomy";
import { eventSlug } from "../slug";
import { getVenueById } from "./venues";

/**
 * Representative sample event data for the Phase 1 product/UX proof (spec
 * section 62). This stands in for the canonical database until the source
 * adapters in src/lib/adapters are wired to real ingestion (Phase 3+). Dates
 * are anchored around August 2026 so "Tonight" / "This weekend" behave
 * correctly out of the box.
 */

let counter = 0;
function nextId(): string {
  counter += 1;
  return `e-${String(counter).padStart(3, "0")}`;
}

interface SeedEventInput {
  title: string;
  artists: string[];
  start: string;
  end?: string | null;
  venueId: string;
  primaryGenre: GenreSlug;
  subgenres?: GenreSlug[];
  genreConfidence?: ConfidenceLevel;
  description?: string | null;
  officialEventUrl?: string | null;
  ticketUrl?: string | null;
  facebookUrl?: string | null;
  residentAdvisorUrl?: string | null;
  otherSourceUrls?: string[];
  imageUrl?: string | null;
  priceFrom?: number | null;
  soldOut?: boolean;
  cancelled?: boolean;
  dateChanged?: boolean;
  timeChanged?: boolean;
  confidence?: ConfidenceLevel;
  canonicalSourceId?: string | null;
  published?: boolean;
}

const SEED_TIMESTAMP = "2026-08-01T09:00:00+02:00";

function mkEvent(input: SeedEventInput): EventRecord {
  const venue = getVenueById(input.venueId);
  if (!venue) throw new Error(`Unknown venue id: ${input.venueId}`);
  return {
    id: nextId(),
    title: input.title,
    slug: eventSlug(input.title, venue.name, input.start, venue.city),
    description: input.description ?? null,
    artists: input.artists,
    startDatetime: input.start,
    endDatetime: input.end ?? null,
    timezone: "Europe/Copenhagen",
    venueId: input.venueId,
    primaryGenre: input.primaryGenre,
    subgenres: input.subgenres ?? [input.primaryGenre],
    genreConfidence: input.genreConfidence ?? "high",
    officialEventUrl: input.officialEventUrl ?? null,
    ticketUrl: input.ticketUrl ?? null,
    facebookUrl: input.facebookUrl ?? null,
    residentAdvisorUrl: input.residentAdvisorUrl ?? null,
    otherSourceUrls: input.otherSourceUrls ?? [],
    imageUrl: input.imageUrl ?? null,
    priceFrom: input.priceFrom ?? null,
    currency: input.priceFrom != null ? "DKK" : null,
    soldOut: input.soldOut ?? false,
    cancelled: input.cancelled ?? false,
    dateChanged: input.dateChanged ?? false,
    timeChanged: input.timeChanged ?? false,
    published: input.published ?? true,
    manualOverride: false,
    confidence: input.confidence ?? "high",
    canonicalSourceId: input.canonicalSourceId ?? null,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    lastSourceCheck: SEED_TIMESTAMP,
    lastChanged: SEED_TIMESTAMP,
  };
}

export const EVENTS: EventRecord[] = [
  // ---- Thu 13 Aug (tonight, relative to seed "now") ----
  mkEvent({
    title: "Low Signal",
    artists: ["SILT", "KY."],
    start: "2026-08-13T23:00:00+02:00",
    end: "2026-08-14T03:00:00+02:00",
    venueId: "v-kb18",
    primaryGenre: "minimal-techno",
    subgenres: ["minimal-techno", "techno"],
    officialEventUrl: "https://example.com/events/low-signal",
    facebookUrl: "https://facebook.com/events/low-signal-kb18",
    priceFrom: 75,
  }),

  // ---- Fri 14 Aug ----
  mkEvent({
    title: "Box Standard",
    artists: ["NAILS", "TEODORA LUX", "MRK."],
    start: "2026-08-14T23:30:00+02:00",
    end: "2026-08-15T06:00:00+02:00",
    venueId: "v-culture-box",
    primaryGenre: "techno",
    subgenres: ["techno", "melodic-techno"],
    officialEventUrl: "https://culture-box.com/events/box-standard",
    ticketUrl: "https://billetto.dk/e/box-standard",
    residentAdvisorUrl: "https://ra.co/events/1234567",
    priceFrom: 120,
  }),
  mkEvent({
    title: "Static Pressure",
    artists: ["DUSK PROTOCOL", "PALE STATIC"],
    start: "2026-08-14T23:00:00+02:00",
    end: "2026-08-15T05:00:00+02:00",
    venueId: "v-gravity",
    primaryGenre: "hard-techno",
    subgenres: ["hard-techno", "industrial"],
    officialEventUrl: "https://gravitycph.dk/events/static-pressure",
    priceFrom: 140,
    genreConfidence: "high",
  }),
  mkEvent({
    title: "Slow Wax",
    artists: ["VESPERTINE", "ARLO NIGHT"],
    start: "2026-08-14T22:00:00+02:00",
    end: "2026-08-15T03:00:00+02:00",
    venueId: "v-jolene",
    primaryGenre: "disco",
    subgenres: ["disco", "house"],
    facebookUrl: "https://facebook.com/events/slow-wax-jolene",
  }),

  // ---- Sat 15 Aug (spec's own reference example) ----
  mkEvent({
    title: "Fast Forward",
    artists: ["ROTOR", "HALVDAN", "GRIT."],
    start: "2026-08-15T23:59:00+02:00",
    end: "2026-08-16T06:00:00+02:00",
    venueId: "v-hangaren",
    primaryGenre: "hard-techno",
    subgenres: ["hard-techno", "industrial"],
    officialEventUrl: "https://www.hangaren.dk/events/fast-forward",
    ticketUrl: "https://billetto.dk/e/fast-forward-hangaren",
    residentAdvisorUrl: "https://ra.co/events/2345678",
    imageUrl: null,
    priceFrom: 175,
  }),
  mkEvent({
    title: "Side Door",
    artists: ["INGRID MAAR", "KAI EMBER"],
    start: "2026-08-15T23:00:00+02:00",
    end: "2026-08-16T05:00:00+02:00",
    venueId: "v-den-anden-side",
    primaryGenre: "house",
    subgenres: ["house", "afro-house"],
    officialEventUrl: "https://www.denandenside.com/events/side-door",
    priceFrom: 130,
  }),
  mkEvent({
    title: "Tight Loop",
    artists: ["RAV.EN", "CLAY & COPPER"],
    start: "2026-08-15T23:00:00+02:00",
    end: "2026-08-16T04:00:00+02:00",
    venueId: "v-vega-ideal-bar",
    primaryGenre: "tech-house",
    ticketUrl: "https://vega.dk/tickets/tight-loop",
    priceFrom: 110,
  }),
  mkEvent({
    title: "Volt Room",
    artists: ["FRAGMENT.", "LOW ORBIT"],
    start: "2026-08-15T23:00:00+02:00",
    end: "2026-08-16T04:30:00+02:00",
    venueId: "v-beta2300",
    primaryGenre: "electro",
    genreConfidence: "medium",
    facebookUrl: "https://facebook.com/events/volt-room-beta2300",
  }),
  mkEvent({
    title: "Overdrawn",
    artists: ["THE NULL SET", "VERA ODEM"],
    start: "2026-08-15T23:00:00+02:00",
    end: "2026-08-16T05:00:00+02:00",
    venueId: "v-warehouse9",
    primaryGenre: "drum-and-bass",
    subgenres: ["drum-and-bass", "garage"],
    priceFrom: 100,
  }),

  // ---- Sun 16 Aug ----
  mkEvent({
    title: "Sunday Session: Slow Build",
    artists: ["IRIS COLD"],
    start: "2026-08-16T16:00:00+02:00",
    end: "2026-08-16T23:00:00+02:00",
    venueId: "v-solvang",
    primaryGenre: "melodic-techno",
    genreConfidence: "medium",
  }),

  // ---- Fri 21 - Sun 23 Aug (next weekend) ----
  mkEvent({
    title: "Cold Room",
    artists: ["MONA STILL", "UNDERTOW."],
    start: "2026-08-21T23:00:00+02:00",
    end: "2026-08-22T05:00:00+02:00",
    venueId: "v-culture-box",
    primaryGenre: "techno",
    residentAdvisorUrl: "https://ra.co/events/2345001",
    priceFrom: 120,
  }),
  mkEvent({
    title: "Ferrous",
    artists: ["DRIFTWERK", "PETRA VOSS"],
    start: "2026-08-22T23:30:00+02:00",
    end: "2026-08-23T06:00:00+02:00",
    venueId: "v-hangaren",
    primaryGenre: "industrial",
    subgenres: ["industrial", "hard-techno"],
    officialEventUrl: "https://www.hangaren.dk/events/ferrous",
    priceFrom: 150,
    soldOut: true,
  }),
  mkEvent({
    title: "Afterglow",
    artists: ["SOLVEIG RAND", "SILT"],
    start: "2026-08-22T22:30:00+02:00",
    end: "2026-08-23T04:00:00+02:00",
    venueId: "v-den-anden-side",
    primaryGenre: "afro-house",
    subgenres: ["afro-house", "deep-house"],
    priceFrom: 110,
  }),
  mkEvent({
    title: "Wax & Wane",
    artists: ["NOVA TERRA"],
    start: "2026-08-22T22:00:00+02:00",
    end: "2026-08-23T03:00:00+02:00",
    venueId: "v-jolene",
    primaryGenre: "deep-house",
  }),
  mkEvent({
    title: "Blackout Radio",
    artists: ["BLACK VELLUM", "KASST"],
    start: "2026-08-22T23:00:00+02:00",
    end: "2026-08-23T05:00:00+02:00",
    venueId: "v-gravity",
    primaryGenre: "hard-techno",
    cancelled: true,
    officialEventUrl: "https://gravitycph.dk/events/blackout-radio",
  }),
  mkEvent({
    title: "Garage Standard",
    artists: ["HANNE SORT", "TOBIAS GRAV"],
    start: "2026-08-23T21:00:00+02:00",
    end: "2026-08-24T02:00:00+02:00",
    venueId: "v-warehouse9",
    primaryGenre: "garage",
  }),

  // ---- Fri 28 - Sun 30 Aug ----
  mkEvent({
    title: "Root & Rise",
    artists: ["OONA BRANDT", "ESKIL HALVOR"],
    start: "2026-08-28T23:00:00+02:00",
    end: "2026-08-29T05:00:00+02:00",
    venueId: "v-culture-box",
    primaryGenre: "house",
    subgenres: ["house", "tech-house"],
    priceFrom: 120,
  }),
  mkEvent({
    title: "Concrete Choir",
    artists: ["NTRNL", "GRIT."],
    start: "2026-08-29T23:59:00+02:00",
    end: "2026-08-30T06:00:00+02:00",
    venueId: "v-hangaren",
    primaryGenre: "techno",
    subgenres: ["techno", "melodic-techno"],
    residentAdvisorUrl: "https://ra.co/events/2345998",
    priceFrom: 160,
  }),
  mkEvent({
    title: "Halfway House",
    artists: ["KAROLINA REYES"],
    start: "2026-08-29T22:00:00+02:00",
    end: "2026-08-30T04:00:00+02:00",
    venueId: "v-vega-ideal-bar",
    primaryGenre: "progressive-house",
  }),
  mkEvent({
    title: "Panel Beat",
    artists: ["FYRVÆRK", "ANDERS KIL"],
    start: "2026-08-29T23:00:00+02:00",
    end: "2026-08-30T05:00:00+02:00",
    venueId: "v-beta2300",
    primaryGenre: "electro",
  }),
  mkEvent({
    title: "Sunday Drift",
    artists: ["LUNAR TIDE"],
    start: "2026-08-30T17:00:00+02:00",
    end: "2026-08-30T23:00:00+02:00",
    venueId: "v-solvang",
    primaryGenre: "ambient-experimental",
    genreConfidence: "medium",
  }),

  // ---- September ----
  mkEvent({
    title: "First Light",
    artists: ["VOID FORM", "DELIA WEST"],
    start: "2026-09-04T23:00:00+02:00",
    end: "2026-09-05T05:00:00+02:00",
    venueId: "v-culture-box",
    primaryGenre: "techno",
    priceFrom: 130,
  }),
  mkEvent({
    title: "Kasst",
    artists: ["KASST", "MRK.", "SILT"],
    start: "2026-09-19T23:30:00+02:00",
    end: "2026-09-20T06:00:00+02:00",
    venueId: "v-culture-box",
    primaryGenre: "techno",
    subgenres: ["techno", "hard-techno"],
    residentAdvisorUrl: "https://ra.co/events/2350112",
    officialEventUrl: "https://culture-box.com/events/kasst",
    priceFrom: 140,
  }),
  mkEvent({
    title: "Basement Tape",
    artists: ["RAV.EN", "HANNE SORT"],
    start: "2026-09-05T23:00:00+02:00",
    end: "2026-09-06T05:00:00+02:00",
    venueId: "v-den-anden-side",
    primaryGenre: "tech-house",
  }),
  mkEvent({
    title: "Signal Loss",
    artists: ["THE NULL SET"],
    start: "2026-09-11T23:00:00+02:00",
    end: "2026-09-12T04:00:00+02:00",
    venueId: "v-kb18",
    primaryGenre: "ambient-experimental",
    genreConfidence: "low",
  }),
  mkEvent({
    title: "Overpass",
    artists: ["DRIFTWERK", "IRIS COLD", "KAI EMBER"],
    start: "2026-09-12T23:59:00+02:00",
    end: "2026-09-13T06:00:00+02:00",
    venueId: "v-hangaren",
    primaryGenre: "hard-techno",
    subgenres: ["hard-techno", "industrial"],
    priceFrom: 170,
    timeChanged: true,
  }),
  mkEvent({
    title: "Afro Standard",
    artists: ["OONA BRANDT", "NOVA TERRA"],
    start: "2026-09-12T22:30:00+02:00",
    end: "2026-09-13T04:00:00+02:00",
    venueId: "v-jolene",
    primaryGenre: "afro-house",
  }),
  mkEvent({
    title: "Rewind Room",
    artists: ["VESPERTINE"],
    start: "2026-09-18T22:00:00+02:00",
    end: "2026-09-19T03:00:00+02:00",
    venueId: "v-vega-ideal-bar",
    primaryGenre: "disco",
  }),
  mkEvent({
    title: "Trance Standard",
    artists: ["HALVDAN", "LUNAR TIDE"],
    start: "2026-09-25T23:00:00+02:00",
    end: "2026-09-26T05:00:00+02:00",
    venueId: "v-gravity",
    primaryGenre: "trance",
    genreConfidence: "medium",
  }),
  mkEvent({
    title: "Deep End",
    artists: ["MONA STILL", "PETRA VOSS"],
    start: "2026-09-26T23:00:00+02:00",
    end: "2026-09-27T05:00:00+02:00",
    venueId: "v-den-anden-side",
    primaryGenre: "deep-house",
  }),
  mkEvent({
    title: "Break Even",
    artists: ["VERA ODEM", "UNDERTOW."],
    start: "2026-09-26T23:00:00+02:00",
    end: "2026-09-27T04:30:00+02:00",
    venueId: "v-warehouse9",
    primaryGenre: "drum-and-bass",
  }),

  // ---- October ----
  mkEvent({
    title: "Night Shift",
    artists: ["NAILS", "GRIT.", "SOLVEIG RAND"],
    start: "2026-10-02T23:30:00+02:00",
    end: "2026-10-03T06:00:00+02:00",
    venueId: "v-culture-box",
    primaryGenre: "techno",
    priceFrom: 130,
  }),
  mkEvent({
    title: "Steel Wool",
    artists: ["DUSK PROTOCOL", "ROTOR"],
    start: "2026-10-10T23:59:00+02:00",
    end: "2026-10-11T06:00:00+02:00",
    venueId: "v-hangaren",
    primaryGenre: "industrial",
    subgenres: ["industrial", "hard-techno"],
    priceFrom: 175,
    residentAdvisorUrl: "https://ra.co/events/2361002",
  }),
  mkEvent({
    title: "Tidal",
    artists: ["INGRID MAAR"],
    start: "2026-10-10T22:30:00+02:00",
    end: "2026-10-11T04:00:00+02:00",
    venueId: "v-jolene",
    primaryGenre: "house",
  }),
  mkEvent({
    title: "Pattern Recognition",
    artists: ["FRAGMENT.", "KY."],
    start: "2026-10-16T23:00:00+02:00",
    end: "2026-10-17T05:00:00+02:00",
    venueId: "v-kb18",
    primaryGenre: "minimal-techno",
  }),
  mkEvent({
    title: "Afterparty Protocol",
    artists: ["THE NULL SET", "BLACK VELLUM"],
    start: "2026-10-17T23:30:00+02:00",
    end: "2026-10-18T06:00:00+02:00",
    venueId: "v-beta2300",
    primaryGenre: "electro",
    dateChanged: true,
  }),
  mkEvent({
    title: "Wide Open",
    artists: ["KAROLINA REYES", "ANDERS KIL"],
    start: "2026-10-24T23:00:00+02:00",
    end: "2026-10-25T05:00:00+02:00",
    venueId: "v-den-anden-side",
    primaryGenre: "progressive-house",
  }),
  mkEvent({
    title: "Halloween Static",
    artists: ["PALE STATIC", "VOID FORM", "MRK."],
    start: "2026-10-31T23:00:00+01:00",
    end: "2026-11-01T06:00:00+01:00",
    venueId: "v-hangaren",
    primaryGenre: "hard-techno",
    subgenres: ["hard-techno", "industrial"],
    priceFrom: 190,
  }),

  // ---- November ----
  mkEvent({
    title: "Low End Theory",
    artists: ["VERA ODEM", "HANNE SORT"],
    start: "2026-11-06T23:00:00+01:00",
    end: "2026-11-07T05:00:00+01:00",
    venueId: "v-warehouse9",
    primaryGenre: "drum-and-bass",
    subgenres: ["drum-and-bass", "garage"],
  }),
  mkEvent({
    title: "Slow Burn",
    artists: ["OONA BRANDT"],
    start: "2026-11-07T22:00:00+01:00",
    end: "2026-11-08T03:00:00+01:00",
    venueId: "v-vega-ideal-bar",
    primaryGenre: "deep-house",
  }),
  mkEvent({
    title: "Concrete Sky",
    artists: ["NTRNL", "DUSK PROTOCOL"],
    start: "2026-11-13T23:59:00+01:00",
    end: "2026-11-14T06:00:00+01:00",
    venueId: "v-culture-box",
    primaryGenre: "techno",
    priceFrom: 140,
  }),
  mkEvent({
    title: "Psy Standard",
    artists: ["LUNAR TIDE", "IRIS COLD"],
    start: "2026-11-14T23:00:00+01:00",
    end: "2026-11-15T05:00:00+01:00",
    venueId: "v-gravity",
    primaryGenre: "psytrance",
    genreConfidence: "medium",
  }),
  mkEvent({
    title: "Night Bus",
    artists: ["MONA STILL", "KAI EMBER"],
    start: "2026-11-20T23:00:00+01:00",
    end: "2026-11-21T05:00:00+01:00",
    venueId: "v-den-anden-side",
    primaryGenre: "tech-house",
  }),
  mkEvent({
    title: "Hard Copy",
    artists: ["ROTOR", "GRIT.", "DRIFTWERK"],
    start: "2026-11-21T23:59:00+01:00",
    end: "2026-11-22T06:00:00+01:00",
    venueId: "v-hangaren",
    primaryGenre: "hard-techno",
    priceFrom: 180,
  }),
  mkEvent({
    title: "Afro Signal",
    artists: ["NOVA TERRA", "SOLVEIG RAND"],
    start: "2026-11-21T22:30:00+01:00",
    end: "2026-11-22T04:00:00+01:00",
    venueId: "v-jolene",
    primaryGenre: "afro-house",
  }),
  mkEvent({
    title: "Wire Frame",
    artists: ["FRAGMENT."],
    start: "2026-11-27T23:00:00+01:00",
    end: "2026-11-28T05:00:00+01:00",
    venueId: "v-kb18",
    primaryGenre: "minimal-techno",
    genreConfidence: "medium",
  }),
  mkEvent({
    title: "Late Csection",
    artists: ["BLACK VELLUM", "VESPERTINE"],
    start: "2026-11-28T23:30:00+01:00",
    end: "2026-11-29T06:00:00+01:00",
    venueId: "v-beta2300",
    primaryGenre: "electro",
  }),

  // ---- December ----
  mkEvent({
    title: "Cold Front",
    artists: ["KASST", "NAILS"],
    start: "2026-12-04T23:30:00+01:00",
    end: "2026-12-05T06:00:00+01:00",
    venueId: "v-culture-box",
    primaryGenre: "techno",
    priceFrom: 140,
  }),
  mkEvent({
    title: "Blacklight",
    artists: ["DUSK PROTOCOL", "PALE STATIC", "UNDERTOW."],
    start: "2026-12-11T23:59:00+01:00",
    end: "2026-12-12T06:00:00+01:00",
    venueId: "v-hangaren",
    primaryGenre: "industrial",
    subgenres: ["industrial", "hard-techno"],
    priceFrom: 180,
  }),
  mkEvent({
    title: "Warm Static",
    artists: ["KAROLINA REYES", "TOBIAS GRAV"],
    start: "2026-12-12T22:30:00+01:00",
    end: "2026-12-13T04:00:00+01:00",
    venueId: "v-den-anden-side",
    primaryGenre: "house",
  }),
  mkEvent({
    title: "Solstice",
    artists: ["IRIS COLD", "OONA BRANDT"],
    start: "2026-12-19T22:00:00+01:00",
    end: "2026-12-20T05:00:00+01:00",
    venueId: "v-warehouse9",
    primaryGenre: "drum-and-bass",
  }),
  mkEvent({
    title: "New Year's Eve: Reset",
    artists: ["KASST", "ROTOR", "MRK.", "SILT"],
    start: "2026-12-31T23:00:00+01:00",
    end: "2027-01-01T08:00:00+01:00",
    venueId: "v-hangaren",
    primaryGenre: "techno",
    subgenres: ["techno", "hard-techno"],
    priceFrom: 350,
    residentAdvisorUrl: "https://ra.co/events/2380500",
  }),
];

export function getEventBySlug(slug: string): EventRecord | undefined {
  return EVENTS.find((e) => e.slug === slug);
}

export function getEventsByVenue(venueId: string): EventRecord[] {
  return EVENTS.filter((e) => e.venueId === venueId);
}

export function publishedEvents(): EventRecord[] {
  return EVENTS.filter((e) => e.published);
}
