import type { FestivalRecord } from "../types";
import type { GenreSlug } from "../taxonomy";
import { slugify } from "../slug";

interface SeedFestivalInput {
  name: string;
  /** Overrides the slug normally derived from `name` — use when a display-name change (e.g. rebranding) should not break an existing /festivals/[slug] URL. */
  slug?: string;
  country: string;
  location: string;
  typicalMonth: string;
  currentDates?: string | null;
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
    currentDates: input.currentDates ?? null,
    genres: input.genres,
    description: input.description,
    officialUrl: input.officialUrl,
    ticketUrl: input.ticketUrl ?? null,
    imageUrl: null,
  };
}

/**
 * Curated, evergreen guide to the festivals most relevant to a Copenhagen
 * electronic audience (spec section 48). Manually maintained by design —
 * only link-health is a candidate for light automation later.
 *
 * This is a general-information guide, not an edition calendar: no field
 * here should ever carry a year, exact edition dates, or edition-status
 * wording (cancelled/hiatus/returns-in/next-edition). `typicalMonth` is the
 * only timing signal shown. `currentDates` remains on the type for
 * compatibility but must stay unset — it must never be used to leak
 * year-specific facts into the public site. Inclusion itself is decided by
 * an internal-only eligibility check (held/holding an edition in 2026, or an
 * officially announced 2027 edition) — that check is not represented in this
 * file or shown publicly; a festival that fails it is simply absent from
 * this list.
 */
export const FESTIVALS: FestivalRecord[] = [
  mk({
    name: "Tomorrowland",
    country: "Belgium",
    location: "Boom",
    typicalMonth: "July",
    genres: ["house", "trance", "electronic-other"],
    description: "The largest mainstage electronic festival in the world, spread across two summer weekends in Boom.",
    officialUrl: "https://www.tomorrowland.com/",
  }),
  mk({
    name: "Awakenings Festival",
    country: "Netherlands",
    location: "Beekse Bergen, Hilvarenbeek",
    typicalMonth: "July",
    genres: ["techno"],
    description: "The Netherlands' flagship techno festival, drawing tens of thousands over a single weekend.",
    officialUrl: "https://www.awakenings.com/",
  }),
  mk({
    name: "Dekmantel Festival",
    country: "Netherlands",
    location: "Amsterdamse Bos, Amsterdam",
    typicalMonth: "July / August",
    genres: ["techno", "house", "electronic-other"],
    description: "Amsterdam forest festival built around the Dekmantel label's deep, selector-driven booking.",
    officialUrl: "https://dekmantelfestival.com/",
  }),
  mk({
    name: "Sónar",
    country: "Spain",
    location: "Barcelona",
    typicalMonth: "June",
    genres: ["electronic-other", "techno", "house"],
    description: "Barcelona's festival for experimental, forward-leaning electronic music and audiovisual art.",
    officialUrl: "https://sonar.es/en",
  }),
  mk({
    name: "Time Warp",
    country: "Germany",
    location: "Mannheim",
    typicalMonth: "March",
    genres: ["techno"],
    description: "Long-running indoor techno marathon in Mannheim's Maimarkthalle, now with satellite editions worldwide.",
    officialUrl: "https://www.timewarp.de/",
  }),
  mk({
    name: "Kappa FuturFestival",
    country: "Italy",
    location: "Turin",
    typicalMonth: "July",
    genres: ["techno", "house"],
    description: "Riverside techno and house festival in Parco Dora, consistently ranked among Europe's best.",
    officialUrl: "https://www.kappafuturfestival.it/en",
  }),
  mk({
    name: "Sonus Festival",
    country: "Croatia",
    location: "Adriatic coast",
    typicalMonth: "August",
    genres: ["techno", "house"],
    description: "Beach-club techno and house festival on Croatia's Adriatic coast, part of the region's beach festival circuit.",
    officialUrl: "https://www.sonus-festival.com/",
  }),
  mk({
    name: "Mysteryland",
    country: "Netherlands",
    location: "Haarlemmermeer",
    typicalMonth: "August",
    genres: ["house", "trance", "electronic-other"],
    description: "One of the world's oldest running dance festivals, spanning a wide range of electronic styles.",
    officialUrl: "https://www.mysteryland.com/en",
  }),
  mk({
    name: "Parookaville",
    country: "Germany",
    location: "Weeze",
    typicalMonth: "July",
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
    genres: ["house", "techno", "trance", "drum-and-bass", "hardstyle"],
    description: "Long-running multi-day mainstage festival at Daresbury Estate in Cheshire, spanning house, techno, trance, drum & bass and hard dance.",
    officialUrl: "https://www.creamfields.com/",
  }),
  mk({
    name: "Ultra Europe",
    country: "Croatia",
    location: "Park Mladeži, Split",
    typicalMonth: "July",
    genres: ["electronic-other", "house", "techno", "trance"],
    description: "Outdoor mainstage festival in Split, Croatia, and the European counterpart to Miami's Ultra Music Festival.",
    officialUrl: "https://ultraeurope.com/",
  }),
  mk({
    name: "UNTOLD",
    country: "Romania",
    location: "Cluj-Napoca",
    typicalMonth: "August",
    genres: ["electronic-other", "house", "techno", "trance"],
    description: "Large-scale mainstage festival held annually in Cluj-Napoca, Romania, with house, techno, trance and EDM programming across multiple stages.",
    officialUrl: "https://untold.com/",
  }),
  mk({
    name: "Tomorrowland Winter",
    country: "France",
    location: "Alpe d'Huez",
    typicalMonth: "March",
    genres: ["house", "techno", "trance", "electronic-other"],
    description: "The ski-resort edition of the Tomorrowland festival brand, held each March at the French alpine resort of Alpe d'Huez, with stages spread across the slopes and village.",
    officialUrl: "https://winter.tomorrowland.com/",
  }),
  mk({
    name: "DGTL",
    country: "Netherlands",
    location: "Amsterdam",
    typicalMonth: "April",
    genres: ["techno", "house"],
    description: "Sustainability-minded techno and house festival held on Amsterdam's NDSM wharf.",
    officialUrl: "https://www.dgtl.nl/en",
  }),
  mk({
    name: "Boom Festival",
    country: "Portugal",
    location: "Idanha-a-Nova",
    typicalMonth: "July",
    genres: ["psytrance", "electronic-other"],
    description: "Biennial psytrance and world-culture gathering on the shores of the Idanha-a-Nova reservoir.",
    officialUrl: "https://boomfestival.org/",
  }),
  // Multi-genre festival with a strong electronic programme, not a dedicated electronic
  // festival — genre tags intentionally left broad rather than claiming a techno/house identity.
  mk({
    name: "Dour Festival",
    country: "Belgium",
    location: "Dour",
    typicalMonth: "July",
    genres: ["electronic-other"],
    description: "Large multi-genre festival in Dour, Belgium, spanning rock, hip-hop and indie line-ups alongside a strong electronic programme across house, techno and bass stages.",
    officialUrl: "https://www.dourfestival.eu/en",
  }),
  mk({
    name: "Fusion Festival",
    country: "Germany",
    location: "Lärz",
    typicalMonth: "June / July",
    genres: ["techno", "house", "electronic-other"],
    description: "Non-commercial, art-driven festival on a former military airfield, long a reference point for European club culture.",
    officialUrl: "https://fusion-festival.de/en/",
  }),
  mk({
    name: "Nature One",
    country: "Germany",
    location: "Kastellaun",
    typicalMonth: "August",
    genres: ["trance", "techno"],
    description: "Trance and techno festival held in a former NATO missile depot in the Hunsrück hills.",
    officialUrl: "https://www.nature-one.de/en/",
  }),
  mk({
    name: "Loveland Festival",
    country: "Netherlands",
    location: "Sloterpark, Amsterdam",
    typicalMonth: "August",
    genres: ["house", "techno"],
    description: "House and techno festival known for its immersive, theatrical stage design.",
    officialUrl: "https://www.lovelandfestival.nl/en",
  }),
  mk({
    name: "Airbeat One",
    country: "Germany",
    location: "Neustadt-Glewe",
    typicalMonth: "July",
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
    genres: ["hardstyle", "rawstyle", "hardcore"],
    description: "Hard dance festival in Biddinghuizen, Netherlands, organised by Q-dance and centred on hardstyle with dedicated rawstyle and hardcore stages.",
    officialUrl: "https://www.defqon1.com/",
  }),
  mk({
    name: "Electric Love Festival",
    country: "Austria",
    location: "Salzburgring, Plainfeld",
    typicalMonth: "July",
    genres: ["electronic-other", "techno", "dubstep", "hardstyle"],
    description: "Electronic dance music festival at the Salzburgring race circuit in Austria, spanning EDM, techno, bass music and hard dance.",
    officialUrl: "https://www.electriclove.at/en/",
  }),
  mk({
    name: "MAYDAY",
    country: "Germany",
    location: "Westfalenhallen, Dortmund",
    typicalMonth: "April",
    genres: ["techno", "trance", "hardstyle", "house"],
    description: "Single-night indoor rave at Dortmund's Westfalenhallen, spanning techno, trance and hardstyle across multiple stages.",
    officialUrl: "https://www.mayday.de/en",
  }),
  mk({
    name: "Masters of Hardcore",
    country: "Netherlands",
    location: "'s-Hertogenbosch",
    typicalMonth: "March",
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
    genres: ["minimal-techno", "deep-house", "techno"],
    description: "Intimate festival at a bungalow village near Olganitz, focused on minimal, deep and understated club sounds. Now runs on a biennial cycle under the Nachti name, from the long-running Nachtdigital label and event series.",
    officialUrl: "https://nachtdigital.de/en",
  }),
  mk({
    name: "Dimensions Festival",
    country: "Croatia",
    location: "The Garden, Tisno",
    typicalMonth: "August / September",
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
    genres: ["drum-and-bass"],
    description: "Annual drum & bass festival held at Lake Most in the Czech Republic, dedicated entirely to the genre.",
    officialUrl: "https://letitroll.eu/",
  }),
  mk({
    name: "Rampage Open Air",
    country: "Belgium",
    location: "Kristalpark, Lommel",
    typicalMonth: "July",
    genres: ["drum-and-bass", "dubstep"],
    description: "Annual drum & bass and dubstep festival at Kristalpark in Lommel, Belgium, the outdoor camping edition of the Rampage event brand.",
    officialUrl: "https://www.rampageopenair.eu/",
  }),
  mk({
    name: "Draaimolen Festival",
    country: "Netherlands",
    location: "Tilburg",
    typicalMonth: "September",
    genres: ["electronic-other", "techno", "ambient-experimental"],
    description: "Independent, non-profit festival known for adventurous, genre-crossing electronic programming.",
    officialUrl: "https://www.draaimolen.nu/",
  }),
  mk({
    name: "Waking Life",
    country: "Portugal",
    location: "Crato",
    typicalMonth: "June",
    genres: ["techno", "ambient-experimental", "electronic-other"],
    description: "Countryside festival in the Alentejo region blending techno, ambient and experimental electronic music and live acts.",
    officialUrl: "https://wakinglife.pt/",
  }),
  mk({
    name: "Reworks Festival",
    country: "Greece",
    location: "Thessaloniki",
    typicalMonth: "September",
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
    genres: ["psytrance", "ambient-experimental", "electronic-other"],
    description: "Psychedelic arts and music festival held near Dádpuszta, Hungary, centred on psytrance with additional ambient and experimental programming.",
    officialUrl: "https://ozorafestival.eu/",
  }),
  // Techno / house / underground
  mk({
    name: "Stone Techno Festival",
    country: "Germany",
    location: "Zeche Zollverein, Essen",
    typicalMonth: "July",
    genres: ["techno"],
    description: "Techno festival held at the former Zollverein coal mine complex in Essen, Germany, with a curated lineup of contemporary and experimental techno.",
    officialUrl: "https://www.stone-techno.com/",
  }),
  mk({
    name: "Nuits Sonores",
    country: "France",
    location: "Lyon",
    typicalMonth: "May",
    genres: ["electronic-other", "techno", "house", "ambient-experimental"],
    description: "Electronic music festival held across venues and public spaces in Lyon, France, spanning techno, house and experimental electronic music.",
    officialUrl: "https://nuits-sonores.com/en/",
  }),
  mk({
    name: "Houghton Festival",
    country: "United Kingdom",
    location: "Houghton Hall, Norfolk",
    typicalMonth: "August",
    genres: ["house", "techno", "electro", "ambient-experimental"],
    description: "Electronic music and arts festival at Houghton Hall in Norfolk, UK, curated by DJ Craig Richards and known for long-format sets across house, techno, electro and ambient.",
    officialUrl: "https://www.houghtonfestival.co.uk/",
  }),
  mk({
    name: "Monegros Desert Festival",
    country: "Spain",
    location: "Fraga",
    typicalMonth: "July",
    genres: ["techno", "hard-techno", "house", "drum-and-bass"],
    description: "Annual electronic music festival in the desert near Fraga, Spain, run as a continuous marathon-format event across techno, hard techno, house and drum & bass.",
    officialUrl: "https://monegrosfestival.com/",
  }),
  mk({
    name: "Love International",
    country: "Croatia",
    location: "The Garden Resort, Tisno",
    typicalMonth: "July",
    genres: ["house", "disco", "techno"],
    description: "Week-long multi-venue festival at The Garden Resort in Tisno, Croatia, spanning house, disco and Balearic-leaning programming.",
    officialUrl: "https://www.loveinternationalfestival.com/",
  }),
  mk({
    name: "Hideout Festival",
    country: "Croatia",
    location: "Zrće Beach, Novalja",
    typicalMonth: "June / July",
    genres: ["house", "techno", "drum-and-bass"],
    description: "Beach-club festival on Zrće Beach, spanning house, tech house, techno and drum & bass across the strip's clubs plus a boat-party programme.",
    officialUrl: "http://www.hideoutfestival.com/",
  }),
  mk({
    name: "NEOPOP Festival",
    country: "Portugal",
    location: "Forte de Santiago da Barra, Viana do Castelo",
    typicalMonth: "August",
    genres: ["techno", "tech-house"],
    description: "Portuguese techno festival at a 16th-century coastal fortress.",
    officialUrl: "https://antipopmusicfestival.com/",
  }),
  mk({
    name: "Amsterdam Dance Event (ADE)",
    country: "Netherlands",
    location: "Amsterdam",
    typicalMonth: "October",
    genres: ["techno", "house", "electronic-other"],
    description: "The world's largest club-culture conference and festival, with thousands of showcases across the city.",
    officialUrl: "https://www.amsterdam-dance-event.nl/en/",
  }),
  mk({
    name: "Sea Dance Festival",
    country: "Montenegro",
    location: "Budva",
    typicalMonth: "August",
    genres: ["house", "techno"],
    description: "Adriatic beach festival near Budva, pairing house and techno line-ups with a wider alternative music bill.",
    officialUrl: "https://seadancefestival.me/",
  }),
  // Copenhagen / Denmark
  mk({
    name: "Distortion",
    country: "Denmark",
    location: "Copenhagen",
    typicalMonth: "June",
    genres: ["house", "techno", "electronic-other"],
    description: "Copenhagen's own street-and-club festival week, closing with a large-scale harbour rave — the local bridge between the city's club scene and the wider European festival circuit.",
    officialUrl: "https://cphdistortion.dk/",
  }),
  mk({
    name: "Karrusel",
    country: "Denmark",
    location: "Refshaleøen, Copenhagen",
    typicalMonth: "August",
    genres: ["house", "techno", "disco", "electronic-other"],
    description: "Festival on Refshaleøen, a former shipyard area in Copenhagen, spanning house, disco and techno across multiple outdoor stages.",
    officialUrl: "https://www.karrusel.dk/",
  }),
];

export function getFestivalBySlug(slug: string): FestivalRecord | undefined {
  return FESTIVALS.find((f) => f.slug === slug);
}
