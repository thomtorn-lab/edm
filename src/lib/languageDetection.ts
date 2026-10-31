/**
 * Small, offline language heuristics for event descriptions (2026-10-25).
 * No network, no model — word counts only.
 */

const DANISH_LETTERS = /[æøåÆØÅ]/;

// Frequent Danish function words that are not English words.
const DANISH_WORDS = new Set(
  "og er det til af på med som har vi du der ikke kan vil fra også eller når hvor mere hele dig jer jeres sig sin sit være bliver blev skal her så men nu deres vores kl".split(" "),
);
// Frequent English function words that are not Danish words.
const ENGLISH_WORDS = new Set(
  "the and of to in is for with on at this that you your are be will we our from by it as an or all their they have has not but night".split(" "),
);

function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+|www\.\S+/g, " ")
      .match(/\p{L}+/gu) ?? []
  );
}

function counts(text: string): { total: number; danish: number; english: number } {
  const ws = words(text);
  let danish = 0;
  let english = 0;
  for (const w of ws) {
    if (DANISH_WORDS.has(w)) danish++;
    else if (ENGLISH_WORDS.has(w)) english++;
  }
  return { total: ws.length, danish, english };
}

/**
 * Plainly English prose: several English function words and (almost) no
 * Danish ones. A Danish place or venue name inside it ("Råhuset",
 * "Kødbyen", "Nørrebro") does not change that.
 */
export function isClearlyEnglishProse(text: string): boolean {
  const c = counts(text);
  return c.english >= 3 && c.danish * 10 <= c.english;
}

/**
 * The Poolen/Pumpehuset English-language guard's test (pre-launch QA audit,
 * 2026-08-29): text containing æ/ø/å is treated as Danish — unless it is
 * plainly English prose. Fix 2026-10-25: before, any æ/ø/å counted, so an
 * English description was dropped just for naming a Danish place. Everything
 * else is unchanged on purpose: a text without æ/ø/å is still never treated
 * as Danish here, and a short Danish text with no English grammar (e.g.
 * "Pumpehuset præsenterer") still is.
 */
export function isLikelyDanish(text: string): boolean {
  return DANISH_LETTERS.test(text) && !isClearlyEnglishProse(text);
}

/**
 * Broader signal for QA reporting only (never used to hide anything): the
 * text reads as Danish by its grammar — at least two Danish function words,
 * more Danish than English ones — whether or not it contains æ/ø/å.
 */
export function readsAsDanish(text: string): boolean {
  const c = counts(text);
  return c.danish >= 2 && c.danish > c.english;
}
