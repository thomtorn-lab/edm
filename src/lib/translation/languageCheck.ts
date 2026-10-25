/**
 * Offline "is this clearly English?" check, shared by the translation job
 * (skips the API for English texts) and the public About text rule
 * (src/lib/translation/englishDescription.ts). No network, no model.
 */

const ENGLISH_WORDS = new Set(
  "the and of to in is for with on at this that you your are be will we our from by it as an or all night music their they have has not but".split(" "),
);
// Frequent function words of the other languages descriptions here arrive
// in (Danish/Norwegian/Swedish/German/Dutch/French/Spanish). Kept to words
// that are not also English words.
const OTHER_WORDS = new Set(
  (
    "og er det til af en på med som den for har vi du der ikke kan vil fra jeres jer også eller når hvor mere nat aften musik " +
    "och att som inte på för av är med " +
    "und der die das ist mit für auf nicht ein eine sie wir " +
    "het een niet voor zijn " +
    "le la les et est pour avec dans une des " +
    "el los las es por con para una"
  ).split(" "),
);

/**
 * Cheap, offline pre-check: true only when the text is very clearly
 * English (plenty of English function words, almost none from other
 * languages). Anything less certain — short texts, mixed-language texts —
 * goes to the model, which decides itself whether anything needs
 * translating. A false "not English" only costs one API call; this function
 * is tuned to never call a non-English text English.
 */
export function isClearlyEnglish(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")
    .match(/\p{L}+/gu);
  if (!words || words.length < 12) return false;
  let english = 0;
  let other = 0;
  for (const w of words) {
    if (ENGLISH_WORDS.has(w)) english++;
    else if (OTHER_WORDS.has(w)) other++;
  }
  return english / words.length >= 0.12 && other / words.length <= 0.01;
}

/**
 * True when a line still reads as non-English: at least 8 words, at least
 * two of them other-language function words, making up 15% or more of the
 * line. Ordinary English lines — even ones naming "Die Antwoord" or "Den
 * Anden Side" — stay well below that; an untranslated Danish sentence is
 * typically far above it.
 */
export function looksUntranslated(line: string): boolean {
  const words = line
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")
    .match(/\p{L}+/gu);
  if (!words || words.length < 8) return false;
  const other = words.filter((w) => OTHER_WORDS.has(w) && !ENGLISH_WORDS.has(w)).length;
  return other >= 2 && other / words.length >= 0.15;
}
