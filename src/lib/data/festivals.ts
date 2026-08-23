import type { FestivalRecord, FestivalEditionStatus } from "../types";
import type { GenreSlug } from "../taxonomy";
import { slugify } from "../slug";
import { confirmed, datesTBA, cancelled, returns, biennial } from "../festivalEdition";

interface SeedFestivalInput {
  name: string;
  /** Overrides the slug normally derived from `name` — use when a display-name change (e.g. rebranding) should not break an existing /festivals/[slug] URL. */
  slug?: string;
  country: string;
  location: string;
  typicalMonth: string;
  edition: FestivalEditionStatus;
  genres: GenreSlug[];
  description: string;
  officialUrl: string;
  ticketUrl?: string | null;
}

let counter = 0;
function mk(input: SeedFestivalInput): FestivalRecord {
  counter += 1;
  return {
    id: `f-${String(counter).padStart(3, "0")}`,
    slug: input.slug ?? slugify(input.name),
    name: input.name,
    country: input.country,
    location: input.location,
    typicalMonth: input.typicalMonth,
    edition: input.edition,
    genres: input.genres,
    description: input.description,
    officialUrl: input.officialUrl,
    ticketUrl: input.ticketUrl ?? null,
    imageUrl: null,
  };
}

/**
 * Curated guide to the festivals most relevant to a Copenhagen electronic
 * audience (spec section 48). Manually maintained by design — only
 * link-health is a candidate for light automation later.
 *
 * Inclusion rule: electronic music / club culture must be either the
 * festival's primary identity, or so fundamental to its programme/culture
 * that an electronic-music audience would reasonably consider it a core
 * electronic destination. A broad multi-genre festival that merely books
 * some electronic acts does not qualify (see UNTOLD / Fusion Festival flags
 * below — kept for now pending a product decision, not auto-removed).
 *
 * `edition` (FestivalEditionStatus, src/lib/types.ts) is the single source
 * of truth for what's shown in place of a date: exact dates only when an
 * official/organizer source confirms them, otherwise the explicit status
 * (Dates TBA / No 2026 edition / Cancelled / Returns YYYY / Biennial).
 * Never both a status and a vague date guess. Verified 2026-08-23 — as of
 * that date most Jan–Aug-dated 2026 editions have already occurred, so
 * "confirmed" below points at each festival's next upcoming edition
 * (already 2027 for many), not a lapsed 2026 date presented as current.
 */
export const FESTIVALS: FestivalRecord[] = [
  mk({
    name: "Tomorrowland",
    country: "Belgium",
    location: "Boom",
    typicalMonth: "July",
    edition: confirmed("17–19 & 24–26 Jul 2027"),
    genres: ["house", "trance", "electronic-other"],
    description: "The largest mainstage electronic festival in the world, spread across two summer weekends in Boom.",
    officialUrl: "https://www.tomorrowland.com/",
  }),
  mk({
    name: "Awakenings Festival",
    country: "Netherlands",
    location: "Beekse Bergen, Hilvarenbeek",
    typicalMonth: "July",
    edition: confirmed("9–11 Jul 2027"),
    genres: ["techno"],
    description: "The Netherlands' flagship techno festival, drawing tens of thousands over a single weekend.",
    officialUrl: "https://www.awakenings.com/",
  }),
  mk({
    name: "Dekmantel Festival",
    country: "Netherlands",
    location: "Amsterdamse Bos, Amsterdam",
    typicalMonth: "July / August",
    edition: datesTBA(),
    genres: ["techno", "house", "electronic-other"],
    description: "Amsterdam forest festival built around the Dekmantel label's deep, selector-driven booking.",
    officialUrl: "https://dekmantelfestival.com/",
  }),
  mk({
    name: "Sónar",
    country: "Spain",
    location: "Barcelona",
    typicalMonth: "June",
    edition: confirmed("17–19 Jun 2027"),
    genres: ["electronic-other", "techno", "house"],
    description: "Barcelona's festival for experimental, forward-leaning electronic music and audiovisual art.",
    officialUrl: "https://sonar.es/en",
  }),
  mk({
    name: "Time Warp",
    country: "Germany",
    location: "Mannheim",
    typicalMonth: "April",
    edition: confirmed("3 Apr 2027"),
    genres: ["techno"],
    description: "Long-running indoor techno marathon in Mannheim's Maimarkthalle — one continuous overnight session across five stages.",
    officialUrl: "https://www.time-warp.de/",
  }),
  mk({
    name: "Kappa FuturFestival",
    country: "Italy",
    location: "Turin",
    typicalMonth: "July",
    edition: confirmed("2–4 Jul 2027"),
    genres: ["techno", "house"],
    description: "Riverside techno and house festival in Parco Dora, consistently ranked among Europe's best.",
    officialUrl: "https://www.kappafuturfestival.it/en",
  }),
  mk({
    name: "Mysteryland",
    country: "Netherlands",
    location: "Haarlemmermeer",
    typicalMonth: "August",
    edition: returns(2027),
    genres: ["house", "trance", "electronic-other"],
    description: "One of the world's oldest running dance festivals, spanning a wide range of electronic styles. Organizer ID&T paused the festival after its 2025 edition for a creative reset, with an explicit return planned for 2027.",
    officialUrl: "https://www.mysteryland.com/en",
  }),
  mk({
    name: "Parookaville",
    country: "Germany",
    location: "Weeze",
    typicalMonth: "July",
    edition: confirmed("16–18 Jul 2027"),
    genres: ["house", "electronic-other"],
    description: "Large-scale mainstage EDM festival built as a fictional festival 'city' near the Dutch border.",
    officialUrl: "https://www.parookaville.com/",
  }),
  // Major electronic / mainstage festivals
  mk({
    name: "Creamfields",
    country: "United Kingdom",
    location: "Daresbury, Cheshire",
    typicalMonth: "August",
    edition: confirmed("27–30 Aug 2026"),
    genres: ["house", "techno", "trance", "drum-and-bass", "hardstyle"],
    description: "Long-running multi-day mainstage festival at Daresbury Estate in Cheshire, spanning house, techno, trance, drum & bass and hard dance.",
    officialUrl: "https://www.creamfields.com/",
  }),
  mk({
    name: "Ultra Europe",
    country: "Croatia",
    location: "Park Mladeži, Split",
    typicalMonth: "July",
    edition: confirmed("9–11 Jul 2027"),
    genres: ["electronic-other", "house", "techno", "trance"],
    description: "Outdoor mainstage festival in Split, Croatia, and the European counterpart to Miami's Ultra Music Festival.",
    officialUrl: "https://ultraeurope.com/",
  }),
  mk({
    name: "UNTOLD",
    country: "Romania",
    location: "Cluj-Napoca",
    typicalMonth: "August",
    edition: confirmed("5–8 Aug 2027"),
    genres: ["electronic-other", "house", "techno", "trance"],
    description: "Large-scale mainstage festival held annually in Cluj-Napoca, Romania, spanning house, techno, trance and EDM alongside a broader pop/hip-hop bill — electronic music remains fundamental to the festival's programme and identity rather than incidental to it.",
    officialUrl: "https://untold.com/",
  }),
  mk({
    name: "Tomorrowland Winter",
    country: "France",
    location: "Alpe d'Huez",
    typicalMonth: "March",
    edition: confirmed("20–27 Mar 2027"),
    genres: ["house", "techno", "trance", "electronic-other"],
    description: "The ski-resort edition of the Tomorrowland festival brand, held each March at the French alpine resort of Alpe d'Huez, with stages spread across the slopes and village.",
    officialUrl: "https://winter.tomorrowland.com/",
  }),
  mk({
    name: "DGTL",
    country: "Netherlands",
    location: "Amsterdam",
    typicalMonth: "March / April",
    edition: confirmed("26–28 Mar 2027"),
    genres: ["techno", "house"],
    description: "Sustainability-minded techno and house festival held on Amsterdam's NDSM wharf.",
    officialUrl: "https://www.dgtl.nl/en",
  }),
  mk({
    name: "Boom Festival",
    country: "Portugal",
    location: "Idanha-a-Nova",
    typicalMonth: "July",
    edition: biennial(2027),
    genres: ["psytrance", "electronic-other"],
    description: "Biennial psytrance and world-culture gathering on the shores of the Idanha-a-Nova reservoir. Runs on odd years — next edition confirmed 18–25 Jul 2027.",
    officialUrl: "https://boomfestival.org/",
  }),
  mk({
    name: "Fusion Festival",
    country: "Germany",
    location: "Lärz",
    typicalMonth: "June / July",
    edition: confirmed("28 Jun–2 Jul 2028"),
    genres: ["techno", "house", "electronic-other"],
    description: "Non-commercial, art-driven festival on a former military airfield, spanning rock, hip-hop, jazz and experimental music alongside a substantial electronic/club programme across dozens of dancefloors — organizers describe Fusion as broader than a single-genre festival, but electronic music and club culture remain fundamental to its identity. Organizers confirmed 2027 is a Fusion-free year, with the next edition dated for 2028.",
    officialUrl: "https://fusion-festival.de/en/",
  }),
  // Multi-genre festival with a strong electronic programme, not a dedicated electronic
  // festival — genre tags intentionally left broad rather than claiming a techno/house identity.
  mk({
    name: "Nature One",
    country: "Germany",
    location: "Kastellaun",
    typicalMonth: "July / August",
    edition: confirmed("29 Jul–1 Aug 2027"),
    genres: ["trance", "techno"],
    description: "Trance and techno festival held in a former NATO missile depot in the Hunsrück hills.",
    officialUrl: "https://www.nature-one.de/en/",
  }),
  mk({
    name: "Loveland Festival",
    country: "Netherlands",
    location: "Sloterpark, Amsterdam",
    typicalMonth: "August",
    edition: confirmed("7–8 Aug 2027"),
    genres: ["house", "techno"],
    description: "House and techno festival known for its immersive, theatrical stage design.",
    officialUrl: "https://www.lovelandfestival.nl/en",
  }),
  mk({
    name: "Airbeat One",
    country: "Germany",
    location: "Neustadt-Glewe",
    typicalMonth: "July",
    edition: confirmed("7–11 Jul 2027"),
    genres: ["trance", "house", "electronic-other"],
    description: "One of Germany's largest EDM festivals, spanning trance, house and mainstage electronic acts.",
    officialUrl: "https://www.airbeat-one.de/en/",
  }),
  // Hard dance / hardstyle / hardcore
  mk({
    name: "Defqon.1",
    country: "Netherlands",
    location: "Biddinghuizen",
    typicalMonth: "June",
    edition: confirmed("24–27 Jun 2027"),
    genres: ["hardstyle", "rawstyle", "hardcore"],
    description: "Hard dance festival in Biddinghuizen, Netherlands, organised by Q-dance and centred on hardstyle with dedicated rawstyle and hardcore stages. The 2026 edition was cancelled mid-event after the Netherlands' first-ever Code Red extreme-heat warning; the 2027 edition is confirmed.",
    officialUrl: "https://www.defqon1.com/",
  }),
  mk({
    name: "Electric Love Festival",
    country: "Austria",
    location: "Salzburgring, Plainfeld",
    typicalMonth: "July",
    edition: confirmed("8–10 Jul 2027"),
    genres: ["electronic-other", "techno", "dubstep", "hardstyle"],
    description: "Electronic dance music festival at the Salzburgring race circuit in Austria, spanning EDM, techno, bass music and hard dance.",
    officialUrl: "https://www.electriclove.at/en/",
  }),
  mk({
    name: "MAYDAY",
    country: "Germany",
    location: "Westfalenhallen, Dortmund",
    typicalMonth: "April",
    edition: confirmed("30 Apr 2027"),
    genres: ["techno", "trance", "hardstyle", "house"],
    description: "Single-night indoor rave at Dortmund's Westfalenhallen, spanning techno, trance and hardstyle across multiple stages.",
    officialUrl: "https://www.mayday.de/en",
  }),
  mk({
    name: "Masters of Hardcore",
    country: "Netherlands",
    location: "'s-Hertogenbosch",
    typicalMonth: "March",
    edition: confirmed("27 Mar 2027"),
    genres: ["hardcore"],
    description: "Indoor hardcore event at the Brabanthallen arena in 's-Hertogenbosch, Netherlands, featuring hardcore, gabber and uptempo artists.",
    officialUrl: "https://www.mastersofhardcore.com/",
  }),
  mk({
    name: "Nachti Festival (by Nachtdigital)",
    slug: "nachtdigital",
    country: "Germany",
    location: "Olganitz",
    typicalMonth: "July / August",
    edition: biennial(2027),
    genres: ["minimal-techno", "deep-house", "techno"],
    description: "Intimate festival at a bungalow village near Olganitz, focused on minimal, deep and understated club sounds. Runs on a biennial cycle (odd years since its 2023 relaunch) under the Nachti name, from the long-running Nachtdigital label and event series — next edition confirmed 30 Jul–1 Aug 2027.",
    officialUrl: "https://nachtdigital.de/en",
  }),
  mk({
    name: "Dimensions Festival",
    country: "Croatia",
    location: "The Garden, Tisno",
    typicalMonth: "August",
    edition: confirmed("27–31 Aug 2026"),
    genres: ["techno", "house", "drum-and-bass"],
    description: "Bay-side festival on the Dalmatian coast spanning techno, house, bass and left-field electronic music.",
    officialUrl: "https://dimensionsfestival.com/",
  }),
  // Drum & bass / bass
  mk({
    name: "Let It Roll",
    country: "Czech Republic",
    location: "Lake Most",
    typicalMonth: "July / August",
    edition: datesTBA(),
    genres: ["drum-and-bass"],
    description: "Annual drum & bass festival held at Lake Most in the Czech Republic, dedicated entirely to the genre. A 2027 edition is confirmed but exact dates are still unsettled between sources at time of writing.",
    officialUrl: "https://letitroll.eu/",
  }),
  mk({
    name: "Rampage Open Air",
    country: "Belgium",
    location: "Kristalpark, Lommel",
    typicalMonth: "July",
    edition: confirmed("2–5 Jul 2027"),
    genres: ["drum-and-bass", "dubstep"],
    description: "Annual drum & bass and dubstep festival at Kristalpark in Lommel, Belgium, the outdoor camping edition of the Rampage event brand.",
    officialUrl: "https://www.rampageopenair.eu/",
  }),
  mk({
    name: "Draaimolen Festival",
    country: "Netherlands",
    location: "Tilburg",
    typicalMonth: "September",
    edition: confirmed("4–5 Sep 2026"),
    genres: ["electronic-other", "techno", "ambient-experimental"],
    description: "Independent, non-profit festival known for adventurous, genre-crossing electronic programming.",
    officialUrl: "https://www.draaimolen.nu/",
  }),
  mk({
    name: "Waking Life",
    country: "Portugal",
    location: "Crato",
    typicalMonth: "June",
    edition: datesTBA(),
    genres: ["techno", "ambient-experimental", "electronic-other"],
    description: "Countryside festival in the Alentejo region blending techno, ambient and experimental electronic music and live acts.",
    officialUrl: "https://wakinglife.pt/",
  }),
  mk({
    name: "Reworks Festival",
    country: "Greece",
    location: "Thessaloniki",
    typicalMonth: "September",
    edition: confirmed("16–20 Sep 2026"),
    genres: ["techno", "house"],
    description: "Thessaloniki's techno and house festival, a fixture of Greece's electronic music calendar.",
    officialUrl: "https://reworksfestival.com/",
  }),
  // Trance / psytrance
  mk({
    name: "O.Z.O.R.A. Festival",
    country: "Hungary",
    location: "Dádpuszta",
    typicalMonth: "July / August",
    edition: datesTBA(),
    genres: ["psytrance", "ambient-experimental", "electronic-other"],
    description: "Psychedelic arts and music festival held near Dádpuszta, Hungary, centred on psytrance with additional ambient and experimental programming.",
    officialUrl: "https://ozorafestival.eu/",
  }),
  mk({
    name: "Mo:Dem Festival",
    country: "Croatia",
    location: "Donje Primišlje",
    typicalMonth: "August",
    edition: datesTBA(),
    genres: ["psytrance", "ambient-experimental", "electronic-other"],
    description: "Riverside canyon festival on the Mrežnica river spanning psytrance, forest, darkpsy, progressive and experimental bass across three distinct stages.",
    officialUrl: "https://modemfestival.com/",
  }),
  // Techno / house / underground
  mk({
    name: "Stone Techno Festival",
    country: "Germany",
    location: "Zeche Zollverein, Essen",
    typicalMonth: "July",
    edition: confirmed("9–11 Jul 2027"),
    genres: ["techno"],
    description: "Techno festival held at the former Zollverein coal mine complex in Essen, Germany, with a curated lineup of contemporary and experimental techno.",
    officialUrl: "https://www.stone-techno.com/",
  }),
  mk({
    name: "Nuits Sonores",
    country: "France",
    location: "Lyon",
    typicalMonth: "May",
    edition: confirmed("5–9 May 2027"),
    genres: ["electronic-other", "techno", "house", "ambient-experimental"],
    description: "Electronic music festival held across venues and public spaces in Lyon, France, spanning techno, house and experimental electronic music.",
    officialUrl: "https://nuits-sonores.com/en/",
  }),
  mk({
    name: "Houghton Festival",
    country: "United Kingdom",
    location: "Houghton Hall, Norfolk",
    typicalMonth: "August",
    edition: datesTBA(),
    genres: ["house", "techno", "electro", "ambient-experimental"],
    description: "Electronic music and arts festival at Houghton Hall in Norfolk, UK, curated by DJ Craig Richards and known for long-format sets across house, techno, electro and ambient.",
    officialUrl: "https://www.houghtonfestival.co.uk/",
  }),
  mk({
    name: "Monegros Desert Festival",
    country: "Spain",
    location: "Fraga",
    typicalMonth: "July / August",
    edition: confirmed("31 Jul–1 Aug 2027"),
    genres: ["techno", "hard-techno", "house", "drum-and-bass"],
    description: "Annual electronic music festival in the desert near Fraga, Spain, run as a continuous marathon-format event across techno, hard techno, house and drum & bass.",
    officialUrl: "https://monegrosfestival.com/",
  }),
  mk({
    name: "Love International",
    country: "Croatia",
    location: "The Garden Resort, Tisno",
    typicalMonth: "July",
    edition: confirmed("7–13 Jul 2027"),
    genres: ["house", "disco", "techno"],
    description: "Week-long multi-venue festival at The Garden Resort in Tisno, Croatia, spanning house, disco and Balearic-leaning programming.",
    officialUrl: "https://www.loveinternationalfestival.com/",
  }),
  mk({
    name: "Hideout Festival",
    country: "Croatia",
    location: "Zrće Beach, Novalja",
    typicalMonth: "June / July",
    edition: datesTBA(),
    genres: ["house", "techno", "drum-and-bass"],
    description: "Beach-club festival on Zrće Beach, spanning house, tech house, techno and drum & bass across the strip's clubs plus a boat-party programme.",
    officialUrl: "http://www.hideoutfestival.com/",
  }),
  mk({
    name: "NEOPOP Festival",
    country: "Portugal",
    location: "Forte de Santiago da Barra, Viana do Castelo",
    typicalMonth: "August",
    edition: confirmed("5–7 Aug 2027"),
    genres: ["techno", "tech-house"],
    description: "Portuguese techno festival at a 16th-century coastal fortress. Its 2026 edition was billed as \"ANTIPOP — 20 Years of NEOPOP\" for that anniversary year only; the festival reverts to the NEOPOP name from 2027.",
    officialUrl: "https://www.neopopfestival.com/",
  }),
  mk({
    name: "Amsterdam Dance Event (ADE)",
    country: "Netherlands",
    location: "Amsterdam",
    typicalMonth: "October",
    edition: confirmed("21–25 Oct 2026"),
    genres: ["techno", "house", "electronic-other"],
    description: "The world's largest club-culture conference and festival, with thousands of showcases across the city.",
    officialUrl: "https://www.amsterdam-dance-event.nl/en/",
  }),
  // London / UK
  mk({
    name: "Junction 2",
    country: "United Kingdom",
    location: "Boston Manor Park, London",
    typicalMonth: "July",
    edition: datesTBA(),
    genres: ["techno", "house"],
    description: "Underground techno and house festival in Boston Manor Park, west London, known for its curated, club-culture-first booking (fabric, Drumcode and selector-driven showcases).",
    officialUrl: "https://www.junction2.london/",
  }),
  mk({
    name: "Terminal V",
    country: "United Kingdom",
    location: "Edinburgh, Scotland",
    typicalMonth: "April",
    edition: datesTBA(),
    genres: ["techno", "house"],
    description: "House and techno festival at Edinburgh's Royal Highland Centre. The 2026 edition was its explicitly final outing in Edinburgh after nine years; the brand continues with Croatian and London editions, with a new host city/date still to be announced.",
    officialUrl: "https://terminalv.co.uk/",
  }),
  // Belgium
  mk({
    name: "Horst Arts & Music Festival",
    country: "Belgium",
    location: "ASIAT Park, Vilvoorde",
    typicalMonth: "May",
    edition: confirmed("6–8 May 2027"),
    genres: ["techno", "house", "electronic-other"],
    description: "Immersive three-day festival blending electronic music, architecture and the arts at ASIAT Park near Brussels.",
    officialUrl: "https://www.horstartsandmusic.com/",
  }),
  mk({
    name: "Extrema Outdoor",
    country: "Belgium",
    location: "Houthalen-Helchteren",
    typicalMonth: "May",
    edition: confirmed("14–16 May 2027"),
    genres: ["house", "techno"],
    description: "Mainstage house and techno festival at De Plas in Houthalen-Helchteren, one of the Low Countries' longest-running electronic festivals.",
    officialUrl: "https://www.extrema.be/en/",
  }),
  // Netherlands — bass / hard dance
  mk({
    name: "Liquicity Festival",
    country: "Netherlands",
    location: "Geestmerambacht, Oudkarspel",
    typicalMonth: "July",
    edition: confirmed("23–25 Jul 2027"),
    genres: ["drum-and-bass"],
    description: "Dedicated liquid and melodic drum & bass weekender at Geestmerambacht, from the Liquicity label and event series.",
    officialUrl: "https://liquicity.com/",
  }),
  mk({
    name: "Decibel Outdoor",
    country: "Netherlands",
    location: "Beekse Bergen, Hilvarenbeek",
    typicalMonth: "August",
    edition: confirmed("28–30 Aug 2026"),
    genres: ["hardstyle", "rawstyle", "hardcore"],
    description: "Three-day harder-styles festival at Safaripark Beekse Bergen, spanning hardstyle, raw, hardcore, uptempo and frenchcore.",
    officialUrl: "https://www.decibeloutdoor.com/",
  }),
  // Malta
  mk({
    name: "Glitch Festival",
    country: "Malta",
    location: "Gianpula Fields, Rabat",
    typicalMonth: "August",
    edition: confirmed("11–14 Aug 2027"),
    genres: ["house", "techno"],
    description: "Malta's foremost electronic music festival, spanning rooftop pool parties, cave raves and a closing boat party across Gianpula's grounds.",
    officialUrl: "https://www.glitchfestival.com/",
  }),
  // Croatia — additional
  mk({
    name: "Dekmantel Selectors",
    country: "Croatia",
    location: "The Garden Resort, Tisno",
    typicalMonth: "August",
    edition: confirmed("20–24 Aug 2026"),
    genres: ["techno", "house", "electronic-other"],
    description: "The Dekmantel label's Adriatic sister event to its Amsterdam festival, a smaller-capacity, selector-driven week on the Tisno coastline.",
    officialUrl: "https://www.dekmantelselectors.com/",
  }),
  // Czech Republic
  mk({
    name: "Beats for Love",
    country: "Czech Republic",
    location: "Dolní Vítkovice, Ostrava",
    typicalMonth: "July",
    edition: confirmed("1–5 Jul 2027"),
    genres: ["techno", "house", "drum-and-bass", "trance", "electronic-other"],
    description: "The largest electronic dance music festival in Central Europe, staged across the former Dolní Vítkovice steelworks with stages spanning EDM, techno, house, drum & bass and trance.",
    officialUrl: "https://www.beatsforlove.cz/en/",
  }),
  // Croatia — cancelled/on hiatus, kept visible with an honest status
  mk({
    name: "Sonus Festival",
    country: "Croatia",
    location: "Zrće Beach",
    typicalMonth: "August",
    edition: cancelled(),
    genres: ["techno", "house"],
    description: "Beach-club techno and house festival that ran on Zrće Beach's over-water venues. The 2026 edition was cancelled after the loss of its Noa Beach Club/Noa Big Beach venues; organizers have pledged a return in 2027 at a new location.",
    officialUrl: "https://www.sonus-festival.com/",
  }),
  // Copenhagen / Denmark
  mk({
    name: "Distortion",
    country: "Denmark",
    location: "Copenhagen",
    typicalMonth: "June",
    edition: confirmed("2–6 Jun 2027"),
    genres: ["house", "techno", "electronic-other"],
    description: "Copenhagen's own street-and-club festival week, closing with a large-scale harbour rave — the local bridge between the city's club scene and the wider European festival circuit.",
    officialUrl: "https://cphdistortion.dk/",
  }),
  mk({
    name: "Karrusel",
    country: "Denmark",
    location: "Refshaleøen, Copenhagen",
    typicalMonth: "August",
    edition: confirmed("27–29 Aug 2026"),
    genres: ["house", "techno", "disco", "electronic-other"],
    description: "Festival on Refshaleøen, a former shipyard area in Copenhagen, spanning house, disco and techno across multiple outdoor stages.",
    officialUrl: "https://www.karrusel.dk/",
  }),
];

export function getFestivalBySlug(slug: string): FestivalRecord | undefined {
  return FESTIVALS.find((f) => f.slug === slug);
}
