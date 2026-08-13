import type { FestivalRecord } from "../types";
import type { GenreSlug } from "../taxonomy";
import { slugify } from "../slug";

interface SeedFestivalInput {
  name: string;
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
    slug: slugify(input.name),
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
 * Curated guide to ~25 of the festivals most relevant to a Copenhagen
 * electronic audience (spec section 48). Manually maintained by design —
 * only dates/link-health are candidates for light automation later.
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
    location: "Spaarnwoude",
    typicalMonth: "June",
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
    genres: ["techno", "house"],
    description: "Beach-club techno and house festival on Pag Island, part of Croatia's Adriatic festival circuit.",
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
    typicalMonth: "August (biennial)",
    genres: ["psytrance", "electronic-other"],
    description: "Biennial psytrance and world-culture gathering on the shores of the Idanha-a-Nova reservoir.",
    officialUrl: "https://boomfestival.org/",
  }),
  mk({
    name: "Dour Festival",
    country: "Belgium",
    location: "Dour",
    typicalMonth: "July",
    genres: ["electronic-other", "techno"],
    description: "Broad alternative-music festival with a consistently strong electronic and bass programme.",
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
    location: "Amsterdam-Duivendrecht",
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
  mk({
    name: "Nachtdigital",
    country: "Germany",
    location: "Olganitz",
    typicalMonth: "July",
    genres: ["minimal-techno", "deep-house", "techno"],
    description: "Intimate, long-running festival at a bungalow village, focused on minimal, deep and understated club sounds.",
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
    typicalMonth: "August",
    genres: ["psytrance", "techno", "electronic-other"],
    description: "Countryside festival in the Alentejo blending psytrance, techno and organic-electronic live acts.",
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
    name: "Melt Festival",
    country: "Germany",
    location: "Ferropolis",
    typicalMonth: "July",
    genres: ["electronic-other", "house", "techno"],
    description: "Electronic and alternative festival staged among the giant excavators of the Ferropolis open-air museum.",
    officialUrl: "https://meltfestival.de/en/",
  }),
  mk({
    name: "Sea Dance Festival",
    country: "Montenegro",
    location: "Budva",
    typicalMonth: "July",
    genres: ["house", "techno"],
    description: "Adriatic beach festival pairing house and techno line-ups with a wider alternative music bill.",
    officialUrl: "https://seadancefestival.me/",
  }),
  mk({
    name: "Distortion",
    country: "Denmark",
    location: "Copenhagen",
    typicalMonth: "June",
    genres: ["house", "techno", "electronic-other"],
    description: "Copenhagen's own street-and-club festival week, closing with a large-scale harbour rave — the local bridge between the city's club scene and the wider European festival circuit.",
    officialUrl: "https://cphdistortion.dk/",
  }),
];

export function getFestivalBySlug(slug: string): FestivalRecord | undefined {
  return FESTIVALS.find((f) => f.slug === slug);
}
