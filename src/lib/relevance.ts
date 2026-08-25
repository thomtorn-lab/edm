/**
 * Source-aware electronic-relevance evidence (Electronic CPH data-quality
 * work package, Workstream A — revised per follow-up review). The product
 * rule is that electronic music must be CENTRAL to an event, not merely
 * present or adjacent. A generalist venue's own broad category tag
 * ("Elektronisk", Billetto's "edm_electronic" subcategory) is real evidence
 * the venue considers the night electronic enough to tag, but it is
 * evidence about the VENUE'S OWN TAXONOMY, not about this specific show —
 * on its own it is never enough to auto-publish.
 *
 * But the goal is BOTH strict inclusion quality AND near-zero routine
 * manual review — a broad category tag plus real, event-specific
 * corroboration (an explicit statement that the artist/event's own sound
 * is electronic, a specific subgenre keyword, or a trusted Resident
 * Advisor link) legitimately clears the bar. This module scores multiple
 * independent signals rather than applying a single blunt genre-floor cap
 * (see assessRelevance) — see pumpehusetAdapter.ts's extractBodyDescription
 * for the parser-side fix that made this real corroborating text available
 * for evaluation in the first place (many Pumpehuset events had genuinely
 * rich event-specific text that the adapter previously never read).
 *
 * Negative evidence (this module's `hasNonElectronicGenreSignal`) is
 * CONTEXTUAL, not simple token occurrence:
 * 1. An artist's own name is masked out of the text before scanning — a
 *    duo literally named "Bingo Fuel" must never fail relevance because
 *    the word "bingo" is in the negative-signal list.
 * 2. A negative-signal word immediately preceded by comparison/lineage
 *    language ("influenced by", "the way X once redefined Y", "shaped by",
 *    "roots in") is not trusted — a genuinely electronic artist's bio
 *    routinely name-drops an influence or makes a genre comparison without
 *    the EVENT itself being that genre (real production evidence: "shaped
 *    by jazz, soul and disco roots"; "the way Nu Metal once redefined
 *    rock" — neither event is jazz or metal).
 * This is deliberately NOT a per-artist allowlist/blocklist — the masking
 * is driven by the event's own extracted artist list, and the comparison
 * suppression is a fixed, generalizable phrase pattern, not a special case
 * per artist or event.
 */

export type RelevanceLevel = "strong" | "weak" | "none";

const NON_ELECTRONIC_GENRE_SIGNALS: RegExp[] = [
  /\bgrime\b/i,
  /\b(hip[\s-]?hop|rapper)\b/i,
  /\b(?:death|black|thrash|doom|sludge|heavy)[\s-]?metal\b/i,
  /\bmetalcore\b/i,
  /\bpunk\b/i,
  /\brock\b/i,
  /\bjazz\b/i,
  /\bfolk\b/i,
  /\breggae\b/i,
  /\bska\b/i,
  /\bchiptune\b/i,
  /\bsinger[\s-]?songwriter\b/i,
  /\bcomedy\b/i,
  /\bstand[\s-]?up\b/i,
  /\bbingo\b/i,
  /\bquiz\b/i,
];

/**
 * Non-electronic EVENT-CATEGORY signals (data-quality Workstream, Billetto
 * queue audit 2026-08-24): a general Copenhagen ticketing aggregator's own
 * inventory is mostly not electronic-music at all — some of it isn't music
 * at ALL (dating, tastings, makeup classes, flea markets, guided tours,
 * wellness), and at least one real recurring case (chamber-music society
 * concerts) IS music, just a different genre the existing word-based genre
 * check doesn't cover. "Category," not "genre" or "non-music": that's the
 * accurate name for what this list actually detects. Real Production
 * evidence, each phrase drawn from actual queued Billetto candidates:
 * "SpeedDating i København 25-35 år", "QualityDating i København 30-45 år"
 * (dating); "MAKEUP FOR MODEN HUD", "DRAG MAKEUP MASTERCLASS" (makeup
 * classes); "Sparkling Wine Festival København", "Ølsmagning med
 * Brygmester" (wine/beer tastings); "Sams Loppemarked i Remisen",
 * "LOPPELINDA på ENGHAVE PLADS", "Byens Lopper X Trianglen" (flea markets —
 * Danish "loppe" = flea); "Unge Talenter // Kammermusikforeningen af 1911"
 * (a chamber-music society's own concert series — real music, non-
 * electronic); "Guided Bike Tour - Ørestad and Sydhavn", "By, brand og
 * borgere – en byvandring i Københavns Kulturkvarter", "Valbyparken:
 * Urtevandringer og sanketure" (guided walking/bike tours — Danish
 * "vandring" = walk/hike); "Self Care Sunday Soundbath™", "Body Temple -
 * Mindful Cuddling" (wellness); "Depeche Modes Violator - musikforedrag"
 * (a KultuNaut real evidence case, source-expansion precision audit
 * 2026-08-25 — Danish "musikforedrag" = "music lecture": a talk about an
 * album's production, not a performance, despite its own description text
 * being dense with "elektronisk"/"elektroniske" describing the band's
 * sound — exactly the kind of case where genre-word density alone would
 * wrongly signal relevance). Deliberately narrow, multi-word/
 * distinctive-root phrases only — never a bare generic word like "wine" or
 * "tour" alone, which a genuinely electronic event could easily mention in
 * passing (an afterparty's wine reception, a tour-date announcement)
 * without being interpreted as evidence.
 *
 * Kept as a SEPARATE list/check from NON_ELECTRONIC_GENRE_SIGNALS rather
 * than merged into it: that list's proper-noun-mid-sentence suppression
 * (isLikelyProperNounMidSentence, built for "Daft Punk" not being punk) is
 * calibrated for single genre WORDS that can coincidentally be part of an
 * artist's stage name — it wrongly suppressed a genuine match here, since a
 * capitalized institutional name like "Kammermusikforeningen" (a chamber-
 * music society's own name, real Production evidence) IS the actual
 * descriptive signal, not a coincidental collision. These are distinctive
 * multi-word/compound phrases, not single common words, so that specific
 * collision risk this module's other suppressions guard against doesn't
 * apply the same way — see hasNonElectronicCategorySignal below for exactly
 * which suppressions still do (and don't) apply.
 */
const NON_ELECTRONIC_CATEGORY_SIGNALS: RegExp[] = [
  /\b(?:speed|quality)[\s-]?dating\b/i,
  /\bmakeup\s+masterclass\b/i,
  // No leading \b before "øl": JS regex word-boundary is ASCII-only, so
  // \bøl fails to match at all before a non-ASCII letter like "ø" — real
  // bug found writing this test against the actual Danish word.
  /(?:vin|øl)smagning\b/i,
  /\bwine\s+(?:festival|tasting)\b/i,
  /\blopp(?:e|er)(?:marked|linda)?\b/i,
  /\bkammermusik\w*/i,
  /\b(?:guided\s+)?(?:bike|walking)\s+tour\b/i,
  // No leading \b: Danish freely compounds without a separator
  // ("byvandring" = "by" + "vandring", one word, real Production evidence)
  // — a word boundary would never appear immediately before the suffix.
  /vandring(?:er)?\b/i,
  /\bsoundbath\b/i,
  /\bmindful\s+cuddling\b/i,
  /\bmusikforedrag\b/i,
];

/**
 * True when the text names a real, non-electronic event CATEGORY (see
 * NON_ELECTRONIC_CATEGORY_SIGNALS above — some non-music entirely, one
 * category — chamber music — real music but a different genre). Still masks
 * the event's own known artists first (same reasoning as
 * hasNonElectronicGenreSignal — an act whose own name happens to overlap
 * must never be penalized for it), but deliberately skips the
 * comparison-cue/historical-credit/proper-noun suppressions that function
 * applies: those exist specifically for common single genre words that can
 * coincidentally be part of a proper name (Daft PUNK); these are
 * distinctive multi-word/compound phrases where that specific
 * false-positive risk doesn't apply, and suppressing a capitalized
 * institutional name (e.g. "Kammermusikforeningen") would wrongly discard
 * the real signal.
 */
export function hasNonElectronicCategorySignal(text: string, knownArtists: string[] = []): boolean {
  const masked = maskKnownArtistNames(text, knownArtists);
  return NON_ELECTRONIC_CATEGORY_SIGNALS.some((pattern) => pattern.test(masked));
}

/**
 * A negative-signal match immediately preceded by one of these comparison/
 * lineage phrases (within a short window) is not trusted — it describes an
 * INFLUENCE or a COMPARISON, not the event's own genre. Deliberately does
 * NOT suppress "blend of X and Y" / "mixes X with Y" style phrasing — that
 * genuinely describes the event's own crossover sound (e.g. MASTER BOOT
 * RECORD + Fulci's own text: "blander chiptune, sludge metal, techno og
 * hardcore punk" — a real description of what this show sounds like, not a
 * lineage aside, and must still count as a real signal).
 */
const COMPARISON_CUE_RE =
  /\b(?:the way|like|similar to|compared to|reminiscent of|influenced by|inspired by|shaped by|roots?\s+in|cues?\s+from|nods?\s+to|redefined|channels?)\b[^.;!?]{0,40}$/i;

/**
 * A negative-signal match preceded (anywhere in the same sentence) by one of
 * these HISTORICAL PERFORMANCE CREDIT phrases is not trusted either — it
 * describes a stage the artist has previously played, not the current
 * event's own musical identity (follow-up review, data-quality Workstream A
 * — real production evidence: tonser's own Pumpehuset bio, itself full of
 * genuine electronic self-description ("elektronisk produktion", "EDM"),
 * closes with "For nylig kunne han også opleves på scenen i Pumpehuset til
 * det udsolgte ... hiphop-event KØL" — a credit that he once played a
 * DIFFERENT, separately-named hip-hop night, not a statement that tonser or
 * THIS show is hip-hop). Same principle as COMPARISON_CUE_RE, generalized
 * to "past stage credit" phrasing rather than "influence/lineage" phrasing —
 * deliberately a fixed, generic phrase pattern, not a per-artist exception.
 */
const HISTORICAL_CREDIT_CUE_RE =
  /\b(?:has (?:played|performed|opened|toured)|played (?:at|with)|performed (?:at|with)|opened for|supported|toured with|previously played|known for playing|kunne(?:\s+\w+){0,2}\s+opleves|har\s+(?:tidligere\s+)?spillet|har\s+(?:tidligere\s+)?optrådt|optrådte|spillede\s+(?:på|til)|tidligere\s+(?:spillet|optrådt))\b/i;

/**
 * A negative-signal match followed by an "-event"/"-festival"/etc. suffix
 * and then a capitalized name is naming a DIFFERENT, specific event/festival
 * (e.g. "hiphop-event KØL") rather than describing the current show — a
 * structural complement to HISTORICAL_CREDIT_CUE_RE for the case where the
 * credit phrasing itself falls outside a fixed-size backward window.
 */
const NAMED_OTHER_EVENT_RE = /^[\s-]?(?:event|festival|koncert|show|tour|klub|club)\b\s+[A-ZÆØÅ]/;

/**
 * Strips a known artist's own name out of `text` (case-insensitive, whole
 * substring match) before negative-signal scanning — see this module's
 * header comment for why (an artist literally named e.g. "Bingo Fuel" must
 * never fail relevance because their own name contains a listed word).
 */
function maskKnownArtistNames(text: string, artists: string[]): string {
  let masked = text;
  for (const name of artists) {
    const trimmed = name.trim();
    if (trimmed.length < 3) continue; // too short to safely mask without collateral damage
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    masked = masked.replace(new RegExp(escaped, "gi"), " ");
  }
  return masked;
}

/**
 * True when a matched word is capitalized AND sits mid-sentence (not right
 * after a sentence boundary or at the very start of the text) — real
 * production evidence found this exact pattern live: "Frankrig har en stolt
 * tradition ... bare tænk på Daft Punk, Air, Justice og David Guetta" (an
 * unambiguous ELECTRONIC-music reference paragraph) and "har samarbejdet
 * med kunstnere som Pharrell Williams, Daft Punk og Wu-Tang Clan" both trip
 * the bare "punk" pattern purely because Daft Punk's own name contains it.
 * Ordinary prose only capitalizes proper nouns and sentence-initial words —
 * a genuine genre reference in running text is essentially always lowercase
 * ("industrial metal", "hardcore punk", "grime"), so a capitalized match
 * that ISN'T sentence-initial is treated as (most likely) part of a proper
 * name, not a genre word. Deliberately not an artist blacklist — this is a
 * structural/orthographic rule that generalizes to any future famous name
 * with the same coincidence, not a hardcoded exception for Daft Punk.
 */
function isLikelyProperNounMidSentence(precedingText: string, matchedWord: string): boolean {
  const firstChar = matchedWord.charAt(0);
  if (firstChar === firstChar.toLowerCase()) return false; // not capitalized at all
  const trimmedBefore = precedingText.replace(/\s+$/, "");
  if (trimmedBefore.length === 0) return false; // start of the whole text — ordinary sentence-initial capital
  const lastChar = trimmedBefore.charAt(trimmedBefore.length - 1);
  if (".!?:\n".includes(lastChar)) return false; // right after a sentence boundary — ordinary sentence-initial capital
  return true;
}

/** Nearest preceding sentence boundary (or start of text) before `index`. */
function precedingSentenceStart(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (".!?:\n".includes(text.charAt(i))) return i + 1;
  }
  return 0;
}

/**
 * True when the given text (title + description/bio) is centered on a
 * recognized non-electronic genre — a strong negative signal against
 * crediting an isolated electronic-sounding word found in the same text.
 * `knownArtists` (the event's own extracted lineup) is masked out first so
 * an artist's own name never triggers a false match.
 */
export function hasNonElectronicGenreSignal(text: string, knownArtists: string[] = []): boolean {
  const masked = maskKnownArtistNames(text, knownArtists);
  for (const pattern of NON_ELECTRONIC_GENRE_SIGNALS) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = global.exec(masked))) {
      const precedingWindow = masked.slice(Math.max(0, match.index - 40), match.index);
      if (COMPARISON_CUE_RE.test(precedingWindow)) continue;
      const sentenceStart = precedingSentenceStart(masked, match.index);
      if (HISTORICAL_CREDIT_CUE_RE.test(masked.slice(sentenceStart, match.index))) continue;
      if (isLikelyProperNounMidSentence(masked.slice(0, match.index), match[0])) continue;
      const matchEnd = match.index + match[0].length;
      if (NAMED_OTHER_EVENT_RE.test(masked.slice(matchEnd, matchEnd + 30))) continue;
      return true; // a genuine, non-suppressed match
    }
  }
  return false;
}

/**
 * A genre root directly compounded with "scene"/"genre" (with or without a
 * space/hyphen — Danish freely compounds without one: "rapscene",
 * "metalscenen") is an explicit first-party claim that the artist/event
 * belongs to THAT scene/genre, not just an isolated word that happens to
 * overlap one. Real production evidence: MASTER BOOT RECORD + Fulci's own
 * intro opens "To af metalscenens mest unikke navne"; Dizzee Rascal's own
 * bio opens "har Dizzee Rascal været en central skikkelse på den britiske
 * rapscene". Deliberately includes a bare "metal"/"rock"/"jazz"/... root
 * here even where the base NON_ELECTRONIC_GENRE_SIGNALS list requires a
 * qualifying prefix (e.g. "death metal") — an explicit "the metal scene"
 * self-identification is unambiguous regardless of subgenre.
 */
const EXPLICIT_NON_ELECTRONIC_IDENTITY_RE =
  /\b(?:grime|hip[\s-]?hop|rap|(?:death|black|thrash|doom|sludge|heavy)?[\s-]?metal|metalcore|punk|rock|jazz|folk|reggae|ska|chiptune)[\s-]?(?:scene|genre)\w*/i;

/**
 * True when the event's own text makes an explicit "X scene/genre" identity
 * claim about a non-electronic genre (see EXPLICIT_NON_ELECTRONIC_IDENTITY_RE)
 * — STRONGER evidence than a bare token match, because the copy is naming
 * its own scene/genre rather than merely using a word that happens to
 * overlap one (follow-up review, data-quality Workstream A — MASTER BOOT
 * RECORD + Fulci's own intro literally opens "To af metalscenens mest
 * unikke navne", yet a single incidental "techno" mention buried in a third
 * support act's blend description was enough to soften the event to REVIEW
 * instead of HOLD under the plain token-occurrence check). Deliberately a
 * fixed, generalizable "<genre-word> + scene/genre" compound pattern, not a
 * per-artist/per-event exception.
 */
export function hasExplicitNonElectronicIdentityAssertion(text: string, knownArtists: string[] = []): boolean {
  const masked = maskKnownArtistNames(text, knownArtists);
  return EXPLICIT_NON_ELECTRONIC_IDENTITY_RE.test(masked);
}

/** The generic electronic-music fallback every adapter uses when it has only
 *  broad/categorical evidence (a venue-wide tag, a platform's catch-all
 *  subcategory) and no specific subgenre keyword match for this event. */
export const GENERIC_ELECTRONIC_GENRE = "electronic-other";

/**
 * Explicit first-party language asserting the ARTIST/EVENT's OWN sound is
 * electronic — stronger than the generic category floor even without a
 * named specific subgenre (e.g. WITCHZ's own Pumpehuset page: "sin
 * dragende, elektroniske lyd" / "mørk electronica"; Halina Rice: "blande
 * følelsesladet elektronisk musik"; Cassius: "en hel æra af elektronisk
 * musik"). Every phrase here was found in real first-party Pumpehuset copy
 * during the data-quality audit — not speculative.
 */
const EXPLICIT_ELECTRONIC_ASSERTION_RE =
  /\b(?:electronic music|electronic sound|electronica|dance music|EDM)\b|\belektronisk[e]?\s+(?:musik\w*|lyd\w*|produktion\w*|beats?\b|scene\w*|kunstner\w*|artist\w*)/i;

export function hasExplicitElectronicAssertion(text: string): boolean {
  return EXPLICIT_ELECTRONIC_ASSERTION_RE.test(text);
}

export interface RelevanceEvidenceInput {
  /** The genre resolved by the deterministic keyword mapper (or an
   *  adapter's own official-metadata hint) against ALL available
   *  first-party text — null if nothing resolved at all. */
  genre: string | null;
  /** Event-specific first-party text explicitly asserts the sound is
   *  electronic (see hasExplicitElectronicAssertion) — independent of
   *  whether a specific subgenre keyword also matched. */
  hasExplicitElectronicAssertion: boolean;
  /** A ticket/RA link corroborates: the source's own linked ticketing
   *  points at Resident Advisor, an electronic-music-specific aggregator —
   *  real, deterministic, non-artist-specific corroboration. */
  hasTrustedElectronicTicketing: boolean;
  /** Contextual non-electronic genre signal (see hasNonElectronicGenreSignal). */
  hasNonElectronicGenreSignal: boolean;
  /** The non-electronic signal is an explicit first-party scene/genre
   *  identity claim, not just an isolated word (see
   *  hasExplicitNonElectronicIdentityAssertion) — stronger than a bare
   *  token match, enough on its own to outweigh a single weak positive
   *  signal. Ignored when hasNonElectronicGenreSignal is false. */
  hasExplicitNonElectronicIdentityAssertion: boolean;
  /** An independent third-party source (today: Discogs artist/release data
   *  — see pipeline.ts::applyEnrichedGenre) corroborates that the lineup is
   *  genuinely electronic, WITHOUT itself naming a specific enough subgenre
   *  to already count via `genre` (follow-up review, weak-evidence
   *  enrichment). Conservative by construction at the call site: only ever
   *  set true on a conservative, unanimous-agreement, never-guessed lookup
   *  — see genreEnrichment.ts's header comment. */
  hasCorroboratingArtistGenreEvidence: boolean;
}

/**
 * Scores independent evidence signals rather than applying one blunt
 * genre-floor cap. A specific genre match, an explicit electronic
 * assertion, and trusted RA/ticket corroboration are each counted as one
 * strong signal — "multiple mutually reinforcing signals" (an explicit
 * design goal) naturally falls out of this without special-casing.
 *
 * - "strong" (auto-publish eligible): at least one strong signal, AND no
 *   contradicting non-electronic signal.
 * - "weak" (review): either only the generic category floor (no strong
 *   signal at all, no contradiction), OR a real contradiction alongside at
 *   least TWO strong signals (a genuine ambiguous crossover, both sides
 *   with real corroboration — e.g. STVW pres. Punk Rave's own copy names
 *   "EDM og trance" AND "pop-punk, emo og rock" in the same breath: "en
 *   hybrid mellem en punkrock-koncert og en intens ravefest").
 * - "none" (hold): a contradiction with no strong signal to offset it; a
 *   contradiction that is an explicit non-electronic SCENE/GENRE identity
 *   claim offset by only one weak/incidental strong signal (the event's own
 *   copy names its own scene as something else — e.g. MASTER BOOT RECORD +
 *   Fulci's own intro: "To af metalscenens mest unikke navne", with the
 *   event's only "electronic" signal being one stray "techno" mention
 *   buried in a third support act's blend description — a single incidental
 *   match must not outweigh the event's own stated identity); or no
 *   evidence of any kind.
 */
export function assessRelevance(input: RelevanceEvidenceInput): RelevanceLevel {
  const hasSpecificGenre = input.genre != null && input.genre !== GENERIC_ELECTRONIC_GENRE;
  const strongSignalCount =
    (hasSpecificGenre ? 1 : 0) +
    (input.hasExplicitElectronicAssertion ? 1 : 0) +
    (input.hasTrustedElectronicTicketing ? 1 : 0) +
    (input.hasCorroboratingArtistGenreEvidence ? 1 : 0);

  if (input.hasNonElectronicGenreSignal) {
    if (strongSignalCount === 0) return "none";
    if (input.hasExplicitNonElectronicIdentityAssertion && strongSignalCount === 1) return "none";
    return "weak";
  }
  if (strongSignalCount > 0) return "strong";
  if (input.genre != null) return "weak"; // generic category floor alone
  return "none";
}
