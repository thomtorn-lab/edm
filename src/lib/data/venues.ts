import type { Venue } from "../types";

/**
 * Canonical venue fixtures. Aliases absorb spelling/capitalization variants
 * seen across sources so the same physical venue never fragments into
 * multiple entries (spec section 37).
 *
 * The running app reads venues from Postgres (src/lib/queries.ts), not this
 * file directly — this is now the seed source for `npm run db:seed` and the
 * fixture data for pure-logic unit tests (normalize.test.ts, dedup.test.ts)
 * that intentionally don't need a live database connection.
 */
export const VENUES: Venue[] = [
  {
    id: "v-culture-box",
    slug: "culture-box",
    name: "Culture Box",
    aliases: ["Culturebox", "CB Kbh", "Culture Box Copenhagen"],
    address: "Kronprinsessegade 54A, 1306 København K",
    city: "Copenhagen",
    postalCode: "1306",
    websiteUrl: "https://culture-box.com/",
    description:
      "Long-running club in three rooms just off Kongens Have, built around techno and house programming with a strict sound-first booking policy.",
  },
  {
    id: "v-hangaren",
    slug: "hangaren",
    name: "Hangaren",
    aliases: ["Hangaren Refshaleøen", "The Hangar CPH"],
    address: "Refshalevej 325, 1432 København K",
    city: "Copenhagen",
    postalCode: "1432",
    websiteUrl: "https://www.hangaren.dk/events",
    description:
      "Raw industrial hall on Refshaleøen used for large-format techno and hard techno nights and one-off warehouse events.",
  },
  {
    id: "v-den-anden-side",
    slug: "den-anden-side",
    name: "Den Anden Side",
    aliases: ["DAS", "Den Anden Side Copenhagen", "Den Anden Side Amager"],
    address: "Krudtløbsvej 8, 2300 København S",
    city: "Copenhagen",
    postalCode: "2300",
    websiteUrl: "https://www.denandenside.com/",
    description:
      "Amager club and event space spanning house, techno and everything adjacent, from intimate club nights to larger showcases.",
  },
  {
    id: "v-gravity",
    slug: "gravity-copenhagen",
    name: "Gravity Copenhagen",
    aliases: ["Gravity CPH", "Gravity Club"],
    address: "Skelbækgade 4, 1717 København V",
    city: "Copenhagen",
    postalCode: "1717",
    websiteUrl: "https://gravitycph.dk/",
    description:
      "Dark, sound-focused club near Halmtorvet built for extended sets across techno, industrial and hypnotic house.",
  },
  {
    id: "v-vega-ideal-bar",
    slug: "vega-ideal-bar",
    name: "VEGA (Ideal Bar)",
    aliases: ["Ideal Bar", "Vega Ideal Bar", "Lille VEGA Ideal Bar"],
    address: "Enghavevej 40, 1674 København V",
    city: "Copenhagen",
    postalCode: "1674",
    websiteUrl: "https://vega.dk/",
    description:
      "The basement club room at VEGA, running house, disco and electro club nights beneath the concert halls upstairs.",
  },
  {
    id: "v-kb18",
    slug: "kb18",
    name: "KB18",
    aliases: ["K.B.18", "KB 18"],
    address: "Krusågade 18, 1719 København V",
    city: "Copenhagen",
    postalCode: "1719",
    websiteUrl: null,
    description:
      "Artist-run project space and club on Vesterbro known for experimental, minimal and left-field electronic programming.",
  },
  {
    id: "v-beta2300",
    slug: "beta2300",
    name: "BETA2300",
    aliases: ["Beta 2300", "Beta Nørrebro"],
    address: "Nørrebrogade 200, 2200 København N",
    city: "Copenhagen",
    postalCode: "2200",
    websiteUrl: null,
    description:
      "Nørrebro event space hosting techno and electro-leaning club nights and touring live acts.",
  },
  {
    id: "v-jolene",
    slug: "jolene",
    name: "Jolene Bar",
    aliases: ["Jolene", "Jolene Copenhagen"],
    address: "Flæsketorvet 81-85, 1711 København V",
    city: "Copenhagen",
    postalCode: "1711",
    websiteUrl: null,
    description:
      "Meatpacking District bar and late-night dancefloor leaning into house, disco and tech house.",
  },
  {
    id: "v-warehouse9",
    slug: "warehouse9",
    name: "WAREHOUSE9",
    aliases: ["Warehouse 9", "WH9"],
    address: "Underground pladsen 9, 1620 København V",
    city: "Copenhagen",
    postalCode: "1620",
    websiteUrl: null,
    description:
      "Underground club under Dybbølsbro known for queer-friendly, bass-forward electronic nights.",
  },
  {
    id: "v-poolen",
    slug: "poolen",
    name: "Poolen",
    aliases: ["Poolen Copenhagen", "Poolen Outside"],
    address: "Refshalevej 189, 1432 København K",
    city: "Copenhagen",
    postalCode: "1432",
    websiteUrl: "https://poolen.dk/",
    description:
      "2,500-capacity warehouse venue on Refshaleøen spanning concerts, club nights and its own outdoor extension, Outside.",
  },
  {
    id: "v-solvang",
    slug: "solvang-hallen",
    name: "Solvang Hallen",
    aliases: ["Solvang Hall", "Solvang Frederiksberg"],
    address: "Solvang 12, 2000 Frederiksberg",
    city: "Frederiksberg",
    postalCode: "2000",
    websiteUrl: null,
    description:
      "Small former sports hall in Frederiksberg repurposed for occasional house and melodic techno showcases.",
  },
];

export function getVenueBySlug(slug: string): Venue | undefined {
  return VENUES.find((v) => v.slug === slug);
}

export function getVenueById(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}
