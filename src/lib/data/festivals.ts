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
 * Curated guide to the festivals most relevant to a Copenhagen electronic
 * audience (spec section 48). Manually maintained by design — only
 * dates/link-health are candidates for light automation later.
 *
 * `currentDates` carries edition-specific facts (a confirmed date range, or a
 * status note like a cancellation/hiatus) that must never be treated as
 * permanent; `location`/`typicalMonth`/`genres`/`description` describe the
 * festival's stable profile. Where an edition's status is genuinely
 * unconfirmed, say so in the text rather than asserting a specific date.
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
    currentDates: "10–12 Jul 2026",
    genres: ["techno"],
    description: "The Netherlands' flagship techno festival, drawing tens of thousands over a single weekend.",
    officialUrl: "https://www.awakenings.com/",
  }),
  mk({
    name: "Dekmantel Festival",
    country: "Netherlands",
    location: "Amsterdamse Bos, Amsterdam",
    typicalMonth: "July / August",
    currentDates: "29 Jul – 2 Aug 2026",
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
    typicalMonth: "April",
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
    location: "Zrće Beach, Novalja",
    typicalMonth: "August",
    currentDates: "2026 edition cancelled — a return is planned for 2027, possibly at a new Croatian venue (unconfirmed)",
    genres: ["techno", "house"],
    description: "Beach-club techno and house festival historically staged at Zrće Beach on Pag Island, part of Croatia's Adriatic festival circuit. The 2026 edition was cancelled after the loss of a venue partner; organisers plan to return in 2027.",
    officialUrl: "https://www.sonus-festival.com/",
  }),
  mk({
    name: "Mysteryland",
    country: "Netherlands",
    location: "Haarlemmermeer",
    typicalMonth: "August",
    currentDates: "No 2026 edition — organisers paused for a year and plan to return in 2027",
    genres: ["house", "trance", "electronic-other"],
    description: "One of the world's oldest running dance festivals, spanning a wide range of electronic styles. It is on a one-year pause for 2026, with a return planned for 2027.",
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
    currentDates: "27–30 Aug 2026",
    genres: ["house", "techno", "trance", "drum-and-bass", "hardstyle"],
    description: "Multi-day mainstage festival at Daresbury Estate in Cheshire, running since 1998 across stages covering house, techno, trance, drum & bass and hard dance.",
    officialUrl: "https://www.creamfields.com/",
  }),
  mk({
    name: "Ultra Europe",
    country: "Croatia",
    location: "Park Mladeži, Split",
    typicalMonth: "July",
    genres: ["electronic-other", "house", "techno", "trance"],
    description: "Outdoor mainstage festival in Split, Croatia, and the European counterpart to Miami's Ultra Music Festival, running annually since 2013.",
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
    currentDates: "20–27 Mar 2027",
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
    typicalMonth: "July (biennial)",
    currentDates: "18–25 Jul 2027 — no 2026 edition",
    genres: ["psytrance", "electronic-other"],
    description: "Biennial psytrance and world-culture gathering on the shores of the Idanha-a-Nova reservoir. The next edition runs 18–25 July 2027; there is no 2026 edition.",
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
    currentDates: "8–9 Aug 2026",
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
    description: "Annual hard dance festival in Biddinghuizen, Netherlands, organised by Q-dance since 2003 and centred on hardstyle with dedicated rawstyle and hardcore stages.",
    officialUrl: "https://www.defqon1.com/",
  }),
  mk({
    name: "Electric Love Festival",
    country: "Austria",
    location: "Salzburgring, Plainfeld",
    typicalMonth: "July",
    genres: ["electronic-other", "techno", "dubstep", "hardstyle"],
    description: "Annual electronic dance music festival at the Salzburgring race circuit in Austria, spanning EDM, techno, bass music and hard dance since 2013.",
    officialUrl: "https://www.electriclove.at/en/",
  }),
  mk({
    name: "MAYDAY",
    country: "Germany",
    location: "Westfalenhallen, Dortmund",
    typicalMonth: "April",
    genres: ["techno", "trance", "hardstyle", "house"],
    description: "Single-night indoor rave at Dortmund's Westfalenhallen, running since 1991 and spanning techno, trance and hardstyle across multiple stages.",
    officialUrl: "https://www.mayday.de/en",
  }),
  mk({
    name: "Nachti Festival (by Nachtdigital)",
    slug: "nachtdigital",
    country: "Germany",
    location: "Olganitz",
    typicalMonth: "July / August (biennial)",
    currentDates: "30 Jul – 1 Aug 2027 — no Olganitz edition in 2026",
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
    currentDates: "16–22 Jun 2026",
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
    description: "Psychedelic arts and music festival held near Dádpuszta, Hungary, since 2004, centred on psytrance with additional ambient and experimental programming.",
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
    description: "Annual electronic music festival held across venues and public spaces in Lyon, France, since 2003, spanning techno, house and experimental electronic music.",
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
    description: "Week-long multi-venue festival at The Garden Resort in Tisno, Croatia, founded in 2014, spanning house, disco and Balearic-leaning programming.",
    officialUrl: "https://www.loveinternationalfestival.com/",
  }),
  mk({
    name: "Hideout Festival",
    country: "Croatia",
    location: "Zrće Beach, Novalja",
    typicalMonth: "June / July",
    genres: ["house", "techno", "drum-and-bass"],
    description: "Annual beach-club festival on Zrće Beach, running since 2011, spanning house, tech house, techno and drum & bass across the strip's clubs plus a boat-party programme.",
    officialUrl: "http://www.hideoutfestival.com/",
  }),
  mk({
    name: "NEOPOP Festival",
    country: "Portugal",
    location: "Forte de Santiago da Barra, Viana do Castelo",
    typicalMonth: "August",
    currentDates: "6–8 Aug 2026, billed as \"ANTIPOP\" for its 20th-anniversary edition",
    genres: ["techno", "tech-house"],
    description: "Long-running Portuguese techno festival at a 16th-century coastal fortress, founded in 2006. Its 20th-anniversary 2026 edition uses the one-off name ANTIPOP.",
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
    location: "Bečići, Budva",
    typicalMonth: "August",
    currentDates: "28–31 Aug 2026",
    genres: ["house", "techno"],
    description: "Adriatic beach festival pairing house and techno line-ups with a wider alternative music bill. Returned in 2026 after a break, now staged on Bečići Beach near Budva.",
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
    currentDates: "27–29 Aug 2026",
    genres: ["house", "techno", "disco", "electronic-other"],
    description: "Festival on Refshaleøen, a former shipyard area in Copenhagen, spanning house, disco and techno across multiple outdoor stages.",
    officialUrl: "https://www.karrusel.dk/",
  }),
];

export function getFestivalBySlug(slug: string): FestivalRecord | undefined {
  return FESTIVALS.find((f) => f.slug === slug);
}
