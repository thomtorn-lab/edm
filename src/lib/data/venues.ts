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
 *
 * CURATED_VENUE_SLUGS (22 venues, as of the 2026-08-29 venue coverage
 * expansion) is the approved /venues highlights list (Interaction + Venue
 * Directory Quality package). This list is a curated editorial highlight
 * reel, NOT an event-ingestion whitelist — Electronic CPH can still publish
 * qualifying events at other Copenhagen venues; being absent here never
 * blocks that. Venues not in that list (BETA2300, Gravity Copenhagen, KB18,
 * Solvang Hallen, WAREHOUSE9) remain real, event-linkable registry entries;
 * they're simply not surfaced on the curated /venues page.
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
    shortDescription:
      "Long-running club near Kongens Have, dedicated to techno and house with international and Danish DJs and a strict sound-first, no-photo booking policy.",
    venueProfile:
      "Culture Box has run as a dedicated electronic music club in central Copenhagen since 2005, a short walk from Kongens Have. The venue's programme is built entirely around techno and house, split across two adjoining rooms — Black Box, the main dancefloor, and Red Box, its adjacent room — that let a single night run two connected lineups at once. Bookings mix touring international DJs with resident and local Danish talent, and the club maintains a strict no-photography policy on the dancefloor to keep the focus on the music rather than the crowd. Its programming has remained genre-focused throughout, without diversifying beyond techno and house.",
  },
  {
    id: "v-hangaren",
    slug: "hangaren",
    name: "Hangaren",
    aliases: ["Hangaren Refshaleøen", "The Hangar CPH"],
    address: "Refshalevej 185, 1432 København K",
    city: "Copenhagen",
    postalCode: "1432",
    websiteUrl: "https://www.hangaren.dk/events",
    description:
      "Raw industrial hall on Refshaleøen used for large-format techno and hard techno nights and one-off warehouse events.",
    shortDescription:
      "Electronic music club in a former hangar on Refshaleøen, hosting its own nights and promoter takeovers across techno, house, trance and harder club sounds.",
    venueProfile:
      "Hangaren occupies a raw industrial hangar on Refshaleøen, the former naval dockyard peninsula that has become one of Copenhagen's main hubs for large-scale electronic events. The venue runs its own club nights alongside regular takeovers by outside promoters and collectives, with programming that spans techno, house, trance and harder club sounds. Its unfinished, warehouse-style interior — high ceilings, exposed structure, minimal decoration — supports a large-format sound and lighting setup built for extended sets rather than a conventional nightclub layout. Alongside neighbouring venues like Poolen, Hangaren has helped establish Refshaleøen as a destination for Copenhagen's club and warehouse-party scene, drawing both local and touring international DJs.",
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
    shortDescription:
      "Amager club and event space built around house and techno, running everything from intimate club nights to larger promoter showcases and touring DJ bookings.",
    venueProfile:
      "Den Anden Side is a club and event space on Amager, running a programme centred on house and techno alongside adjacent electronic styles. Its booking spans two ends of the same scene: intimate, resident-led club nights on one hand, and larger showcases and promoter takeovers with touring international DJs on the other, giving the venue a broader range than a single-genre room. The space is used flexibly across different room configurations depending on the size of the event, from smaller club nights to bigger one-off parties. Den Anden Side has become one of the newer fixtures in Copenhagen's electronic scene outside the traditional Vesterbro and Refshaleøen clusters, extending the city's club map onto Amager.",
  },
  {
    id: "v-module",
    slug: "module",
    name: "MODULE",
    aliases: ["Module Copenhagen", "Module CPH"],
    address: "Vesterbrogade 2B, 1620 København V",
    city: "Copenhagen",
    postalCode: "1620",
    websiteUrl: null,
    description:
      "Basement nightclub near Copenhagen City Hall built specifically for house, techno and industrial sound, with a strict no-photo policy.",
    shortDescription:
      "Basement nightclub near Copenhagen City Hall built specifically for house, techno and industrial sound, running underground club nights with a strict no-photo policy.",
    venueProfile:
      "MODULE is a basement nightclub in central Copenhagen, a short walk from City Hall Square, built specifically around house, techno and industrial electronic music. The venue occupies a three-part basement layout — a small kiosk area, a lounge, and the main room. Like several of the city's dedicated techno rooms, MODULE enforces a no-photography policy on the dancefloor to keep focus on the music. Programming mixes touring international DJs with local bookings, positioning MODULE among the newer additions to Copenhagen's underground club circuit.",
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
    shortDescription:
      "Meatpacking District bar and late-night dancefloor built around house, disco and tech house, running Friday techno nights alongside its weekend bar programme.",
    venueProfile:
      "Jolene Bar sits in Copenhagen's Meatpacking District (Kødbyen), functioning as both a neighbourhood bar earlier in the evening and a late-night dancefloor once the DJ booth takes over. Its regular electronic programming leans into house, disco and tech house, with a recurring Friday night techno slot that has become one of its signature bookings. The room is compact and bar-first in character rather than a purpose-built club, giving it a more casual, drop-in feel than the district's dedicated nightclubs. Jolene is one of several venues clustered in Kødbyen — alongside Baggen and Basement — that make the former meatpacking district one of Copenhagen's densest concentrations of electronic-leaning nightlife.",
  },
  {
    id: "v-baggen",
    slug: "baggen",
    name: "Baggen",
    aliases: ["Baggen Copenhagen", "Baggen Kødbyen"],
    address: "Flæsketorvet 19, 1711 København V",
    city: "Copenhagen",
    postalCode: "1711",
    websiteUrl: null,
    description:
      "Bar, club and gallery in the Meatpacking District, running house, techno and disco nights in a low-lit, industrial room.",
    shortDescription:
      "Bar, club and gallery in the Meatpacking District, running house, techno and disco nights across its basement dancefloor in a low-lit, industrial room.",
    venueProfile:
      "Baggen combines a bar, club and gallery space in Copenhagen's Meatpacking District (Kødbyen), with its electronic programming concentrated in a basement dancefloor reached via a narrow staircase from the street-level bar. The room's low-lit, industrial character — exposed surfaces, minimal styling — suits its regular house, techno and disco bookings, alongside occasional gallery and art programming upstairs that broadens the venue beyond a single-purpose club. Alongside Jolene and Basement, it's one of several rooms in the district that keep electronic music a consistent part of the area's late-night programme rather than an occasional booking.",
  },
  {
    id: "v-klub-werkstatt",
    slug: "klub-werkstatt",
    name: "Klub Werkstatt",
    aliases: ["Werkstatt", "Werkstatt 167"],
    address: "Refshalevej 167A, 1432 København K",
    city: "Copenhagen",
    postalCode: "1432",
    websiteUrl: "https://werkstatt167.dk/",
    description:
      "Bar and club on Refshaleøen inside a former engine workshop, pairing emerging local DJ bookings with touring names.",
    shortDescription:
      "Bar and club on Refshaleøen inside a former engine workshop, pairing emerging local DJ bookings with touring names across techno and wider electronic music.",
    venueProfile:
      "Klub Werkstatt occupies a former engine workshop on Refshaleøen, the industrial peninsula that has become a hub for Copenhagen's warehouse-style club scene. The building's original workshop character — raw brick, exposed machinery-era structure — remains part of the room's identity rather than being fully converted into a conventional nightclub interior. Its booking policy leans toward supporting emerging local DJ talent, giving newer names club nights alongside touring international artists across techno and broader electronic styles. Alongside neighbouring venues like Hangaren and Poolen, Klub Werkstatt is part of the cluster of Refshaleøen spaces that has turned the former naval dockyard area into one of Copenhagen's main destinations for electronic club nights.",
  },
  {
    id: "v-basement",
    slug: "basement",
    name: "Basement",
    aliases: ["Basement CPH", "Basement Vesterbro"],
    address: "Enghavevej 42, 1674 København V",
    city: "Copenhagen",
    postalCode: "1674",
    websiteUrl: null,
    description:
      "Small, municipally-run underground event space beside VEGA in Vesterbro, hosting electronic music nights and art programming.",
    shortDescription:
      "Small, municipally-run underground event space beside VEGA in Vesterbro, hosting electronic music nights and art programming in a converted basement room.",
    venueProfile:
      "Basement is a compact underground event space in Vesterbro, run as part of the Vesterbro Library and Culture House and located in a backyard immediately next to VEGA. Reached down a narrow staircase, the room hosts a mix of electronic music nights, live performances and art exhibitions rather than operating as a conventional commercial nightclub — its programming leans experimental and platform-style, supporting newer artists and smaller promoters. Because of its municipal affiliation, Basement sits slightly apart from Copenhagen's private club circuit, functioning more as a small, flexible cultural venue that regularly makes room for electronic programming than as a dedicated club. Its location next to VEGA and proximity to Enghave Plads station puts it within the same nightlife pocket as several of the city's other club venues.",
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
      "Large-scale warehouse venue on Refshaleøen spanning concerts, club nights and its own outdoor extension, Outside.",
    shortDescription:
      "Large-scale warehouse venue on Refshaleøen from the team behind Pumpehuset, spanning concerts and club nights plus its own outdoor extension, Outside.",
    venueProfile:
      "Poolen is a large-format warehouse venue on Refshaleøen, built inside a former B&W industrial hall by the team behind Pumpehuset. It is one of the larger rooms in the city's electronic and concert circuit, built with a substantial sound and lighting rig to match. Programming spans full concerts and touring live acts alongside club nights and promoter takeovers, with electronic bookings forming an increasingly large part of its calendar. Poolen also runs Outside, an adjoining outdoor extension used for open-air parties and festival-style events during warmer months. Alongside Hangaren and Klub Werkstatt, Poolen anchors Refshaleøen as one of Copenhagen's main large-scale electronic and warehouse-event destinations.",
  },
  {
    id: "v-pumpehuset",
    slug: "pumpehuset",
    name: "Pumpehuset",
    aliases: ["Pumpehuset Copenhagen", "The Pumpehuset"],
    address: "Studiestræde 52, 1554 København V",
    city: "Copenhagen",
    postalCode: "1554",
    websiteUrl: "https://pumpehuset.dk/",
    description:
      "A former 19th-century pump station near City Hall that doubles as a concert hall and, on weekends, a late-night club — its programming crosses genres but regularly makes room for electronic nights.",
    shortDescription:
      "A former 19th-century pump station near City Hall that doubles as a concert hall and, on weekends, late-night club — crossing genres but regularly making room for electronic nights.",
    venueProfile:
      "Pumpehuset occupies a former 19th-century pump station near Copenhagen City Hall, repurposed as a concert hall that also runs as a late-night club on weekends. Its regular programme spans live concerts, touring bands and multi-genre bookings, with outside electronic promoters regularly taking over on weekend nights for house, techno and broader club-oriented lineups. The building's original industrial architecture is retained inside a converted concert-hall layout, giving Pumpehuset a larger-capacity setting than most of the city's dedicated club rooms. Byhaven is Pumpehuset's own area for free-entry pop-up parties, running its own recurring line-up of daytime and early-evening electronic events distinct from the venue's main ticketed concert programme. Because electronic programming shares the calendar with concerts and other genres rather than running every night, Pumpehuset functions as an occasional but consistent electronic venue rather than a full-time club.",
  },
  {
    id: "v-rust",
    slug: "rust",
    name: "RUST",
    aliases: ["Rust Copenhagen", "RUST Natklub"],
    address: "Guldbergsgade 8, 2200 København N",
    city: "Copenhagen",
    postalCode: "2200",
    websiteUrl: null,
    description:
      "Three-floor bar, concert stage and club in Nørrebro running since 1989, one of Copenhagen's longest-standing nightlife institutions.",
    shortDescription:
      "Three-floor bar, concert stage and club in Nørrebro running since 1989, with weekend club floors moving through techno, house and electro.",
    venueProfile:
      "RUST is a three-floor venue in Nørrebro that has operated since 1989, making it one of Copenhagen's longest-running nightlife institutions. The building combines a live concert stage with several bar and club floors, giving it a dual identity as both a touring-band venue and a late-night club. On weekend nights, RUST's club floors move through techno, house and electro programming, run alongside its own promoters and occasional external bookings, while its main stage continues to host concerts across a wider range of genres. The venue's scale and longevity have made it a fixture of Nørrebro's nightlife rather than a niche club, with its electronic programming forming a consistent, if not exclusive, part of its weekly calendar.",
  },
  {
    id: "v-h15",
    slug: "h15",
    name: "H15",
    aliases: ["H15 Kødbyen", "H15 Mad og Kultur"],
    address: "Halmtorvet 15, 1700 København V",
    city: "Copenhagen",
    postalCode: "1700",
    websiteUrl: null,
    description:
      "Restored 1950s freight-hall venue in the Meatpacking District combining a bar, restaurant and event space.",
    shortDescription:
      "Restored 1950s freight-hall venue in the Meatpacking District combining a bar and restaurant with club nights, concerts and cultural events.",
    venueProfile:
      "H15 occupies a restored 1950s freight hall in Copenhagen's Meatpacking District, converted into a multi-use space combining a bar, restaurant and event venue. Its programming deliberately mixes formats — club nights sit alongside concerts, art exhibitions and film screenings — rather than running as a dedicated electronic club, which gives H15 a broader cultural identity than most of the district's other rooms. Electronic and club-oriented nights make up part of that wider calendar, taking advantage of the hall's industrial-scale interior and flexible layout. As one of the newer additions to Kødbyen's converted-warehouse cluster, H15 adds a more genre-mixed alternative to the area's dedicated techno and house rooms.",
  },
  {
    id: "v-bolsjefabrikken",
    slug: "bolsjefabrikken",
    name: "Bolsjefabrikken",
    aliases: ["Bolsjefabrikken Copenhagen"],
    address: "Ragnhildgade 1, 2100 København Ø",
    city: "Copenhagen",
    postalCode: "2100",
    websiteUrl: null,
    description:
      "Self-run, non-commercial culture house in a former candy factory in Østerbro, hosting underground concerts and electronic parties.",
    shortDescription:
      "Self-run, non-commercial culture house in a former candy factory in Østerbro, hosting underground concerts and electronic parties alongside workshops and community events.",
    venueProfile:
      "Bolsjefabrikken is a self-run, non-commercial culture house in Østerbro, housed in a former candy factory and operated as a collectively run free space rather than a conventional business. Its programme covers underground concerts, electronic parties, workshops and community events, reflecting its roots as a volunteer-organised space rather than a promoter-driven club. Electronic nights sit alongside a wider mix of cultural and political programming, and pricing and access are generally kept low and community-oriented in line with the venue's non-commercial ethos. Bolsjefabrikken represents one of Copenhagen's more explicitly DIY, artist-run spaces that still regularly hosts electronic music.",
  },
  {
    id: "v-odds-and-ends",
    slug: "odds-and-ends",
    name: "Odds and Ends",
    aliases: ["Odds & Ends", "Tunnelfabrikken"],
    address: "Oceanvej 1, 2150 Nordhavn",
    city: "Copenhagen",
    postalCode: "2150",
    websiteUrl: "https://oddsandends.dk/",
    description:
      "Industrial-scale event space in the developing Nordhavn district, with a large flexible hall and outdoor festival area.",
    shortDescription:
      "Industrial-scale event space in the developing Nordhavn district, with a large flexible hall and outdoor area increasingly used for club nights and bigger electronic line-ups.",
    venueProfile:
      "Odds and Ends is an industrial-scale event space in Nordhavn, Copenhagen's developing waterfront district, built inside the former Tunnelfabrikken industrial site. The venue combines a large flexible indoor hall with an outdoor festival-style area, giving it a scale closer to a warehouse or festival site than a conventional club room. Its programming spans a wide range of formats — private and corporate events sit alongside public club nights — with electronic line-ups making up an increasing share of its public programme as bigger promoters take advantage of the space's size. As Nordhavn continues to develop, Odds and Ends has become one of the district's main venues for large-scale electronic events, alongside the area's other converted industrial buildings.",
  },
  {
    id: "v-mayhem",
    slug: "mayhem",
    name: "Mayhem",
    aliases: ["Mayhem KBH", "Mayhem Copenhagen"],
    address: "Ragnhildgade 1, 2100 København Ø",
    city: "Copenhagen",
    postalCode: "2100",
    websiteUrl: null,
    description:
      "Artist-run underground venue in Østerbro known for experimental programming spanning noise, techno and ambient electronic music.",
    shortDescription:
      "Artist-run underground venue in Østerbro hosting experimental programming that spans noise, techno and ambient electronic music, alongside broader underground concerts.",
    venueProfile:
      "Mayhem is an artist-run underground venue in Østerbro, operating from an unmarked space that positions it outside Copenhagen's conventional club circuit. Its programming leans experimental, spanning noise, techno, ambient and other left-field electronic styles alongside underground concerts more broadly, reflecting a curatorial approach built around artistic risk-taking rather than mainstream club bookings. The venue is volunteer-run and non-commercial in character, similar to other DIY spaces in the city, with a scrappy, low-production aesthetic rather than a polished nightclub interior. Mayhem shares its building complex with other independent Østerbro spaces, and its combination of noise, ambient and techno programming makes it one of the more distinctly experimental rooms within Copenhagen's wider electronic music scene.",
  },
  {
    id: "v-tap1",
    slug: "tap1",
    name: "TAP1",
    aliases: ["Tap 1", "TAP1 Copenhagen"],
    address: "Raffinaderivej 10, 2300 København S",
    city: "Copenhagen",
    postalCode: "2300",
    websiteUrl: "https://www.tap1.dk/",
    description:
      "Large former distillery hall on Amager, originally linked to Carlsberg, hosting big-room electronic line-ups alongside concerts and festivals.",
    shortDescription:
      "Large former distillery hall on Amager, originally linked to Carlsberg, hosting big-room electronic line-ups and touring DJs alongside concerts and festival events.",
    venueProfile:
      "TAP1 is a large event hall on Amager, built inside a former distillery building originally associated with the Carlsberg brewery. The hall's industrial scale and open floor plan make it suited to big-room formats, and its programming spans electronic club-style line-ups and touring international DJs alongside concerts, conferences, exhibitions and trade fairs — a broader commercial-venue remit than a dedicated nightclub. Electronic promoters use TAP1 for larger-capacity events that outgrow the city's smaller club rooms, taking advantage of its size and flexible layout rather than a fixed sound or lighting identity tied to one genre. TAP1 functions as one of Copenhagen's go-to large-format venues when an electronic event needs more room than a standard club can offer.",
  },
  {
    id: "v-underwerket",
    slug: "underwerket",
    name: "UnderWerket",
    aliases: ["Underwerket", "UnderWerket Valby"],
    address: "Valgårdsvej 2, 2500 Valby",
    city: "Copenhagen",
    postalCode: "2500",
    websiteUrl: null,
    description:
      "Volunteer-run, youth-oriented venue in Valby offering rehearsal and event space for young organisers, including electronic nights.",
    shortDescription:
      "Volunteer-run, youth-oriented DIY venue in Valby offering rehearsal and event space for young organisers, including electronic and techno nights alongside concerts.",
    venueProfile:
      "UnderWerket is a volunteer-run venue in Valby aimed at young organisers, offering rooms, sound equipment and organisational support for self-run events rather than operating as a commercial club. Alongside concerts and youth-organised gatherings, the space regularly hosts electronic and techno nights, including noise and experimental programming from independent local promoters. Its basement setting and community-support model give it a different character from Copenhagen's commercial club venues — events are typically organised by the young promoters themselves rather than booked in by the venue. UnderWerket's role in the city's electronic scene is smaller-scale and more grassroots than the larger clubs, functioning as an entry point for new organisers putting on their first electronic events.",
  },
  {
    // KultuNaut audit follow-up (2026-09-05): this row's `name` was
    // previously the bare "VEGA" — even though its own description/profile
    // text below already correctly scoped it to the basement club room, not
    // VEGA's main concert halls. Because resolveVenue() (src/lib/normalize.ts)
    // does exact normalized-name matching, that bare name meant ANY future
    // source supplying literal "VEGA" (KultuNaut's own event pages do — see
    // ArrNr 20004550/19768459/etc — but this generalizes to any source, not
    // just KultuNaut) would silently resolve to this Ideal-Bar-specific
    // venue, even for a genuine Store VEGA arena show. No `aliases` entry was
    // ever bare "VEGA" either — this was purely the `name` field overclaiming
    // the whole building. Renamed to "VEGA (Ideal Bar)", already the exact
    // string this repo's own venueCreation.test.ts expected
    // (`slugifyVenueName("VEGA (Ideal Bar)")`) before this fix — the seed
    // data had simply never been updated to match. Deliberately NOT adding
    // separate "Store VEGA"/"Lille VEGA" rows: no currently-registered source
    // supplies text specific enough to justify them, and inventing venue
    // rows without real event evidence isn't the goal here — a bare "VEGA"
    // string now correctly resolves to nothing (manual review) rather than
    // silently attaching to this specific room.
    id: "v-vega-ideal-bar",
    slug: "vega-ideal-bar",
    name: "VEGA (Ideal Bar)",
    aliases: ["Ideal Bar", "Vega Ideal Bar", "Lille VEGA Ideal Bar", "VEGA (Ideal Bar)"],
    address: "Enghavevej 40, 1674 København V",
    city: "Copenhagen",
    postalCode: "1674",
    websiteUrl: "https://vega.dk/",
    description:
      "The basement club room at VEGA, running house, disco and electro club nights beneath the concert halls upstairs.",
    shortDescription:
      "Basement club room inside VEGA's landmark concert hall building, running house, disco and electro club nights beneath the main concert halls upstairs.",
    venueProfile:
      "VEGA is one of Copenhagen's best-known concert venues, and its basement club room — Ideal Bar — is the building's dedicated space for electronic and club-oriented nights, running beneath VEGA's main concert halls. While VEGA's main stages host touring bands and larger concerts across genres, Ideal Bar operates as a late-night club room in its own right, with a programme built around house, disco and electro. The room's identity is distinct from the concert halls above it — smaller, more intimate and club-focused rather than seated- or standing-concert oriented. As part of the wider VEGA building, Ideal Bar gives the venue a consistent electronic-club presence alongside its primary identity as a concert hall.",
  },
  {
    id: "v-alice",
    slug: "alice",
    name: "ALICE",
    aliases: ["ALICE Copenhagen", "ALICE cph"],
    address: "Nørre Allé 7, 2200 København N",
    city: "Copenhagen",
    postalCode: "2200",
    websiteUrl: null,
    description:
      "Nørrebro music venue and listening bar spanning jazz, live music and electronic programming.",
    shortDescription:
      "Nørrebro music venue and listening bar spanning jazz, live music and electronic programming, positioned as a space for exploratory, open-minded audiences.",
    venueProfile:
      "ALICE is a music venue in Nørrebro that combines a bar with a programme spanning jazz, live music and electronic sets, positioning itself as a space for curious listeners rather than a single-genre club. Its electronic programming sits alongside live jazz and other performance formats, giving ALICE a more genre-fluid identity than Copenhagen's dedicated techno and house rooms. The venue's setting favours a listening-bar atmosphere — closer to a small concert room than a large dancefloor-first club — which shapes the kind of electronic programming it hosts, often leaning toward more textured or DJ-set formats than peak-time club nights. ALICE adds a distinct, cross-genre voice to Nørrebro's music scene, complementing the area's other electronic venues like RUST with a smaller, more intimate format.",
  },
  {
    id: "v-hotel-cecil",
    slug: "hotel-cecil",
    name: "Hotel Cecil",
    aliases: ["Cecil", "Cecil AM", "Hotel Cecil Copenhagen"],
    address: "Niels Hemmingsens Gade 10, 1153 København K",
    city: "Copenhagen",
    postalCode: "1153",
    websiteUrl: "https://www.hotelcecil.dk/",
    description:
      "Central Copenhagen concert venue that also runs Cecil AM, a weekend club night with a curated line-up of electronic DJs.",
    shortDescription:
      "Central Copenhagen concert venue that also runs Cecil AM, a Friday/Saturday club night with a curated line-up of local and international electronic DJs.",
    venueProfile:
      "Hotel Cecil is a concert venue in central Copenhagen. Alongside its regular programme of local and touring live bands, the venue runs Cecil AM, a recurring Friday and Saturday night club that turns the space over to a curated line-up of local and international electronic DJs once the concert programme wraps up. Cecil AM is not a separate venue but the same room and address operating under a different name for its late-night club identity. The building includes a main room and an upstairs bar, giving it a moderate scale suited to club-length sets rather than large-format warehouse events. Hotel Cecil's dual identity — concert hall by early evening, electronic club night as Cecil AM later on — makes it one of central Copenhagen's more flexible venues for electronic programming.",
  },
  {
    id: "v-halvandet",
    slug: "halvandet",
    name: "Halvandet",
    aliases: ["Halvandet Copenhagen", "Halvandet Refshaleøen"],
    address: "Refshalevej 325, 1432 København K",
    city: "Copenhagen",
    postalCode: "1432",
    websiteUrl: null,
    description:
      "Refshaleøen harbour-bath beach bar with a seasonal programme of house and disco-leaning DJ sets.",
    shortDescription:
      "Refshaleøen harbour-bath beach bar with a summer programme of house and disco-leaning DJ sets alongside its waterfront restaurant and bathing area.",
    venueProfile:
      "Halvandet is a beach bar and harbour-bath venue on Refshaleøen, combining a waterfront restaurant and swimming area with a DJ programme that runs primarily through the warmer months. Its setting — sand, deck chairs and open water views alongside the harbour bath — gives it a distinctly outdoor, seasonal character rather than the indoor club format of its Refshaleøen neighbours like Hangaren and Poolen. Electronic programming leans toward house and disco-leaning DJ sets suited to a daytime-into-evening beach-bar atmosphere rather than a late-night club night. Halvandet is reachable by the harbour water bus as well as by bike or bus, reflecting its position within the wider Refshaleøen redevelopment. Within Copenhagen's electronic scene, Halvandet offers a lighter, more casual counterpart to the area's warehouse-scale club venues.",
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
    shortDescription: null,
    venueProfile: null,
  },
  {
    id: "v-kb18",
    slug: "kb18",
    name: "KB18",
    aliases: ["K.B.18", "KB 18"],
    // NOT corrected in the 2026-08-29 venue coverage expansion audit:
    // secondary sources (Songkick, Yelp, Facebook, TransArtists,
    // Foursquare) consistently place KB18 at "Kødboderne 18" instead of
    // this stored address, and suggest it's still active — but first-party
    // 2026 evidence wasn't strong enough this round to justify a Production
    // write. Left untouched pending a dedicated verification pass.
    address: "Krusågade 18, 1719 København V",
    city: "Copenhagen",
    postalCode: "1719",
    websiteUrl: null,
    description:
      "Artist-run project space and club on Vesterbro known for experimental, minimal and left-field electronic programming.",
    shortDescription: null,
    venueProfile: null,
  },
  {
    id: "v-beta2300",
    slug: "beta2300",
    name: "BETA2300",
    aliases: ["Beta 2300", "Beta Amager"],
    // Corrected 2026-08-29 (venue coverage expansion audit): the previous
    // "Nørrebrogade 200, 2200 København N" address contradicted the venue's
    // own name — "2300" is the Amager postal code, not Nørrebro's 2200.
    // Independently verified (Yelp, Facebook, Instagram, setlist.fm) at
    // Øresundsvej 6 in Amager instead.
    address: "Øresundsvej 6, 2300 København S",
    city: "Copenhagen",
    postalCode: "2300",
    websiteUrl: null,
    description:
      "Amager event space hosting techno and electro-leaning club nights and touring live acts.",
    shortDescription: null,
    venueProfile: null,
  },
  {
    id: "v-warehouse9",
    slug: "warehouse9",
    name: "WAREHOUSE9",
    aliases: ["Warehouse 9", "WH9"],
    // Corrected 2026-08-29 (venue coverage expansion audit). The previous
    // "Underground pladsen 9, 1620 København V" address matched no source.
    // An earlier pass proposed "Halmtorvet 11 C" from secondary sources
    // (Wikipedia, Yelp, VisitCopenhagen) — its long-standing Meatpacking
    // District address — but the venue's own current official site states
    // its 2026 address as Rosenlunds Allé 5, Vanløse instead; corrected to
    // that first-party value.
    address: "Rosenlunds Allé 5, Baghuset, 2720 Vanløse",
    city: "Copenhagen",
    postalCode: "2720",
    websiteUrl: null,
    description:
      "Performance-art venue, gallery and queer social space in Vanløse, hosting occasional club and nightlife nights alongside its core art and theatre programme.",
    shortDescription: null,
    venueProfile: null,
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
    shortDescription: null,
    venueProfile: null,
  },
  {
    id: "v-pylonen",
    slug: "pylonen",
    name: "Pylonen",
    aliases: ["Pylonen Langebro", "Frizonen Langebro"],
    // Verified 2026-08-29 directly against the venue's own official site
    // (pylonen.horse — live-fetched, HTTP 200): exact address and GPS
    // coordinates both confirmed (55°40'14.8"N 12°34'38.6"E).
    address: "Christians Brygge 31, 1219 Copenhagen K",
    city: "Copenhagen",
    postalCode: "1219",
    websiteUrl: "https://pylonen.horse/",
    description:
      "Temporary art-and-event space under the Langebro bridge, running a mixed 2026 season that includes house and techno day parties from Copenhagen crews like Pleasure Control.",
    shortDescription:
      "Temporary outdoor/indoor space under Langebro bridge, running a mixed 2026 programme of art, markets and parties, including house and techno nights from local crews like Pleasure Control.",
    venueProfile:
      "Pylonen is a temporary event and art space built into the raw edge under the Langebro bridge at Christians Brygge, on the water between Vesterbro and Christianshavn. Framed by its organisers as \"a raw edge between water, traffic and the unknown,\" it runs a full seasonal programme mixing art, markets, performance and outdoor parties rather than a single fixed genre identity. Its electronic programming includes outdoor day parties from established Copenhagen house and techno crews such as Pleasure Control, alongside a residency slot from the Fluid Sound Collective. As a temporary, seasonally-organised space rather than a permanent club, its exact form can change between seasons, but its current 2026 installation runs a booked calendar through December.",
  },
  // The following four venues (Rört, Råhuset, Henrikgaardens, KLEIN) were
  // added 2026-08-31 (Billetto venue-registration activation): each was
  // identified as blocking real, currently-qualifying Billetto candidates
  // via a resolved-venue registry gap, not a code/relevance defect. Address
  // and identity for each is drawn only from Billetto's own consistent,
  // repeated event listings (same location_name + address_line across
  // multiple independent events, plus a self-named organiser account in
  // two cases) — no independent website could be reached from this
  // sandbox's egress-restricted environment to corroborate further, so
  // websiteUrl/description are kept minimal and strictly evidence-based
  // rather than invented.
  {
    id: "v-rort",
    slug: "rort",
    name: "Rört",
    aliases: [],
    // Billetto's own event listings ("KLUB Rört", "Dance x Sauna") both
    // give this exact address, with organiser account name "Rört" — a
    // separate Billetto listing using the similar-but-distinct spelling
    // "Rørt" at a different address (Østergade 26C, 1100) was found and is
    // NOT treated as the same venue (different organiser, no corroborating
    // evidence they are the same physical space) — see the activation
    // report for that open discrepancy.
    address: "Thoravej 35, 2400 København NV",
    city: "Copenhagen",
    postalCode: "2400",
    websiteUrl: "https://rort.dk/",
    description:
      "Community space in Nordvest hosting a members' club night, Klub Rört, alongside wellness and social events.",
    shortDescription: null,
    venueProfile: null,
  },
  {
    id: "v-rahuset",
    slug: "rahuset",
    name: "Råhuset",
    aliases: [],
    // Billetto's own event listings ("Electro Werkz", "Wyatt E. x Five The
    // Hierophant", plus several non-electronic bookings) consistently give
    // this address; one listing's own organiser account is named "Råhuset".
    address: "Onkel Dannys Pl. 7, 1711 København V",
    city: "Copenhagen",
    postalCode: "1711",
    websiteUrl: null,
    description: "Vesterbro event space with a mixed programme spanning electronic club nights, comedy and live music.",
    shortDescription: null,
    venueProfile: null,
  },
  {
    id: "v-henrikgaardens",
    slug: "henrikgaardens",
    name: "Henrikgaardens",
    aliases: ["Henrikgaardens selskabslokale"],
    // Billetto's own listing ("EleKtro Universal: Mini Festival") gives
    // this address; "selskabslokale" (function/banquet room) is part of
    // Billetto's own location_name string, kept as an alias rather than
    // the canonical name.
    address: "Vigerslev Vænge 68, 2500 Valby",
    city: "Copenhagen",
    postalCode: "2500",
    websiteUrl: null,
    description: "Valby function room hosting a booked electronic mini-festival programme.",
    shortDescription: null,
    venueProfile: null,
  },
  {
    id: "v-klein",
    slug: "klein",
    name: "KLEIN",
    aliases: [],
    // Billetto's own event listings ("Zoumer", "Yalla Miku", "Yoni Mayraz")
    // consistently give this address; one listing's own organiser account
    // is named "KLEIN".
    address: "Wagnersvej 19, 2450 København SV",
    city: "Copenhagen",
    postalCode: "2450",
    websiteUrl: null,
    description: "Sydhavnen event space running a recurring electronic club-night programme.",
    shortDescription: null,
    venueProfile: null,
  },
  // Venue-block activation round (2026-08-31 follow-up): these three venues
  // each blocked exactly one CURRENT, UPCOMING Billetto candidate whose real
  // counterfactual quality-gate decision (src/lib/adapters/pipeline.ts's
  // computeVenueResolvedCounterfactual) was AUTO-PUBLISH — venue resolution
  // was the ONLY thing blocking each. Unlike the Rört/Råhuset/Henrikgaardens/
  // KLEIN batch above, this environment has real (though egress-limited)
  // web access — addresses were independently corroborated via each venue's
  // own official/municipal site plus at least one independent directory
  // (Danish CVR business registry, property registry, or Yelp), never
  // inferred from the Billetto event title alone.
  {
    id: "v-lygten-station",
    slug: "lygten-station",
    name: "Lygten Station",
    aliases: [],
    // Former Copenhagen–Slangerup railway station, now a Københavns
    // Kommune-run cultural centre. Address confirmed via the municipality's
    // own kulturogfritidn.kk.dk site and corroborated by Yelp and the
    // Danish CVR business registry (CVR-nr 64942212). Billetto's own venue
    // string ("Lygten Station") matches this canonical name exactly.
    address: "Lygten 2, 2400 København NV",
    city: "Copenhagen",
    postalCode: "2400",
    websiteUrl: null,
    description: "Former railway station in Nordvest, now a municipal cultural centre hosting concerts, comedy and theatre.",
    shortDescription: null,
    venueProfile: null,
  },
  {
    id: "v-copenhill",
    slug: "copenhill",
    name: "CopenHill",
    aliases: [],
    // Waste-to-energy plant with a rooftop ski slope, hiking trail and
    // event/bar space (also known as Amager Bakke). Address confirmed via
    // the venue's own official site (copenhill.dk) and corroborated by
    // Google Maps and Visit Copenhagen. Billetto's own venue string
    // ("CopenHill") matches this canonical name exactly.
    address: "Vindmøllevej 6, 2300 København S",
    city: "Copenhagen",
    postalCode: "2300",
    websiteUrl: "https://www.copenhill.dk/",
    description: "Waste-to-energy plant topped with a rooftop ski slope, hiking trail and event space on Refshaleøen/Amager.",
    shortDescription: null,
    venueProfile: null,
  },
  {
    id: "v-kube",
    slug: "kube",
    name: "KU.BE",
    aliases: [],
    // Frederiksberg municipality's culture-and-movement house. Address
    // confirmed via the venue's own official site (kube.frederiksberg.dk)
    // and corroborated by Yelp and the Danish address/property registries
    // (dingeo.dk, resights.dk). Billetto's own venue string ("KU.BE")
    // matches this canonical name exactly.
    address: "Dirch Passers Allé 4, 2000 Frederiksberg",
    city: "Copenhagen",
    postalCode: "2000",
    websiteUrl: "https://kube.frederiksberg.dk/",
    description: "Frederiksberg culture and movement house spanning performance, workshop and library spaces across four floors.",
    shortDescription: null,
    venueProfile: null,
  },
];

/**
 * The approved /venues highlights list (21 venues), in the exact editorial
 * order the overview page displays them — see /venues' own page.tsx. Kept
 * here, next to the fixtures it references, so the curated set and the
 * registry data it draws from can't silently drift apart. Extending this
 * list requires explicit approval, same as the page-level rule it replaces.
 */
export const CURATED_VENUE_SLUGS: readonly string[] = [
  "culture-box",
  "hangaren",
  "den-anden-side",
  "module",
  "jolene",
  "baggen",
  "klub-werkstatt",
  "basement",
  "pumpehuset",
  "poolen",
  "rust",
  "h15",
  "bolsjefabrikken",
  "odds-and-ends",
  "mayhem",
  "tap1",
  "underwerket",
  "vega-ideal-bar",
  "alice",
  "hotel-cecil",
  "halvandet",
  "pylonen",
];

export function getVenueBySlug(slug: string): Venue | undefined {
  return VENUES.find((v) => v.slug === slug);
}

export function getVenueById(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}
