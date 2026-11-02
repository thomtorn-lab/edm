/**
 * Controlled genre taxonomy — the single source of truth for every genre
 * surface (admin editors, homepage filter, genre pages, badges, search,
 * newsletter preferences, classification). Nothing else hardcodes genre
 * strings or hierarchy rules.
 *
 * Genre system revision (2026-10-24, approved model):
 *   - An event carries at most two DIRECT genre tags (`primaryGenre` +
 *     `subgenres`). Parent genres are derived from the hierarchy below and
 *     never stored or counted as a tag.
 *   - A genre has a stable internal id (`slug`, the value stored in the
 *     database — never renamed), a display `label`, and a public `urlSlug`
 *     (plus optional `urlAliases`). Renaming a genre is a label/urlSlug
 *     change in this file, never a data migration — "Garage" became
 *     "UK Garage" (/?genre=uk-garage) while every stored value stays
 *     "garage".
 *   - Hierarchy is one level deep: a MAIN genre (Techno, House, Trance,
 *     Drum & Bass, Hardstyle) has subgenres; every other genre is
 *     standalone. Selecting a main genre matches the main genre and all its
 *     subgenres; selecting any other genre is an exact match
 *     (matchesGenreSelection).
 *   - Visual groups ("Bass & Breaks", "Hard Dance", ...) are headings in
 *     option lists only: never selectable, never a URL, never stored.
 *   - Industrial (the industrial/EBM line) and Industrial Techno (a techno
 *     subgenre) are different genres; Industrial is standalone and is NOT
 *     part of the Techno filter. Hardcore (gabber lineage, also covering
 *     "hardcore techno") is standalone, not a Hardstyle subgenre.
 *   - "ambient-experimental" is a LEGACY stored value (split into Ambient
 *     and Experimental): still displayable and filterable so existing
 *     admin-locked events keep working until reviewed, but no longer
 *     selectable.
 */

export type GenreSlug =
  | "techno"
  | "hard-techno"
  | "industrial-techno"
  | "hypnotic-techno"
  | "melodic-techno"
  | "minimal-techno"
  | "house"
  | "deep-house"
  | "tech-house"
  | "progressive-house"
  | "afro-house"
  | "disco"
  | "trance"
  | "psytrance"
  | "drum-and-bass"
  | "jungle"
  | "breakbeat"
  | "garage"
  | "dubstep"
  | "hardstyle"
  | "rawstyle"
  | "hardcore"
  | "electro"
  | "industrial"
  | "ambient"
  | "experimental"
  | "electronic-other"
  | "ambient-experimental";

export type VisualGroupSlug = "techno" | "house-disco" | "trance" | "bass-breaks" | "hard-dance" | "electro-experimental" | "other";

export interface VisualGroupDef {
  slug: VisualGroupSlug;
  label: string;
}

/** Option-list headings, in display order. Presentation only — see the module comment. */
export const VISUAL_GROUPS: VisualGroupDef[] = [
  { slug: "techno", label: "Techno" },
  { slug: "house-disco", label: "House & Disco" },
  { slug: "trance", label: "Trance" },
  { slug: "bass-breaks", label: "Bass & Breaks" },
  { slug: "hard-dance", label: "Hard Dance" },
  { slug: "electro-experimental", label: "Electro & Experimental" },
  { slug: "other", label: "Other" },
];

export interface GenreDef {
  /** Internal id — the value stored in the database. Never renamed. */
  slug: GenreSlug;
  label: string;
  /** Short label used in dense UI (event rows, filter chips). */
  shortLabel: string;
  /** Public URL value (`?genre=`, `/genres/[urlSlug]`). */
  urlSlug: string;
  /** Older URL values that still resolve to this genre. */
  urlAliases?: readonly string[];
  /** The main genre this is a subgenre of; absent for main and standalone genres. */
  parent?: GenreSlug;
  visualGroup: VisualGroupSlug;
  /** Stored value kept for backward compatibility only — not selectable anywhere. */
  legacy?: true;
  /**
   * Legacy values only: the current genres this value still matches in a
   * filter, so an unreviewed event is never hidden from every genre option
   * ("Ambient / Experimental" shows under both Ambient and Experimental).
   */
  alsoMatches?: readonly GenreSlug[];
}

const GENRE_CATALOG: GenreDef[] = [
  { slug: "techno", label: "Techno", shortLabel: "Techno", urlSlug: "techno", visualGroup: "techno" },
  { slug: "hard-techno", label: "Hard Techno", shortLabel: "Hard Techno", urlSlug: "hard-techno", parent: "techno", visualGroup: "techno" },
  { slug: "industrial-techno", label: "Industrial Techno", shortLabel: "Industrial Techno", urlSlug: "industrial-techno", parent: "techno", visualGroup: "techno" },
  { slug: "hypnotic-techno", label: "Hypnotic Techno", shortLabel: "Hypnotic Techno", urlSlug: "hypnotic-techno", parent: "techno", visualGroup: "techno" },
  { slug: "melodic-techno", label: "Melodic Techno", shortLabel: "Melodic Techno", urlSlug: "melodic-techno", parent: "techno", visualGroup: "techno" },
  { slug: "minimal-techno", label: "Minimal Techno", shortLabel: "Minimal Techno", urlSlug: "minimal-techno", parent: "techno", visualGroup: "techno" },

  { slug: "house", label: "House", shortLabel: "House", urlSlug: "house", visualGroup: "house-disco" },
  { slug: "deep-house", label: "Deep House", shortLabel: "Deep House", urlSlug: "deep-house", parent: "house", visualGroup: "house-disco" },
  { slug: "tech-house", label: "Tech House", shortLabel: "Tech House", urlSlug: "tech-house", parent: "house", visualGroup: "house-disco" },
  { slug: "progressive-house", label: "Progressive House", shortLabel: "Progressive House", urlSlug: "progressive-house", parent: "house", visualGroup: "house-disco" },
  { slug: "afro-house", label: "Afro House", shortLabel: "Afro House", urlSlug: "afro-house", parent: "house", visualGroup: "house-disco" },
  { slug: "disco", label: "Disco", shortLabel: "Disco", urlSlug: "disco", visualGroup: "house-disco" },

  { slug: "trance", label: "Trance", shortLabel: "Trance", urlSlug: "trance", visualGroup: "trance" },
  { slug: "psytrance", label: "Psytrance", shortLabel: "Psytrance", urlSlug: "psytrance", parent: "trance", visualGroup: "trance" },

  { slug: "drum-and-bass", label: "Drum & Bass", shortLabel: "Drum & Bass", urlSlug: "drum-and-bass", visualGroup: "bass-breaks" },
  { slug: "jungle", label: "Jungle", shortLabel: "Jungle", urlSlug: "jungle", parent: "drum-and-bass", visualGroup: "bass-breaks" },
  { slug: "breakbeat", label: "Breakbeat", shortLabel: "Breakbeat", urlSlug: "breakbeat", visualGroup: "bass-breaks" },
  { slug: "garage", label: "UK Garage", shortLabel: "UK Garage", urlSlug: "uk-garage", urlAliases: ["garage"], visualGroup: "bass-breaks" },
  { slug: "dubstep", label: "Dubstep", shortLabel: "Dubstep", urlSlug: "dubstep", visualGroup: "bass-breaks" },

  { slug: "hardstyle", label: "Hardstyle", shortLabel: "Hardstyle", urlSlug: "hardstyle", visualGroup: "hard-dance" },
  { slug: "rawstyle", label: "Rawstyle", shortLabel: "Rawstyle", urlSlug: "rawstyle", parent: "hardstyle", visualGroup: "hard-dance" },
  { slug: "hardcore", label: "Hardcore", shortLabel: "Hardcore", urlSlug: "hardcore", visualGroup: "hard-dance" },

  { slug: "electro", label: "Electro", shortLabel: "Electro", urlSlug: "electro", visualGroup: "electro-experimental" },
  { slug: "industrial", label: "Industrial", shortLabel: "Industrial", urlSlug: "industrial", visualGroup: "electro-experimental" },
  { slug: "ambient", label: "Ambient", shortLabel: "Ambient", urlSlug: "ambient", visualGroup: "electro-experimental" },
  { slug: "experimental", label: "Experimental", shortLabel: "Experimental", urlSlug: "experimental", visualGroup: "electro-experimental" },

  // Fallback: only on its own, only when nothing more precise can be
  // documented (see validateGenreTags).
  { slug: "electronic-other", label: "Electronic / Other", shortLabel: "Electronic", urlSlug: "electronic-other", visualGroup: "other" },

  { slug: "ambient-experimental", label: "Ambient / Experimental", shortLabel: "Ambient", urlSlug: "ambient-experimental", visualGroup: "electro-experimental", legacy: true, alsoMatches: ["ambient", "experimental"] },
];

/** Every selectable genre, in admin/filter display order (legacy values excluded). */
export const GENRES: GenreDef[] = GENRE_CATALOG.filter((g) => !g.legacy);

const GENRE_BY_SLUG = new Map(GENRE_CATALOG.map((g) => [g.slug, g]));

/** Any stored genre, including legacy values (display, filtering). */
export function getGenre(slug: GenreSlug): GenreDef {
  const g = GENRE_BY_SLUG.get(slug);
  if (!g) throw new Error(`Unknown genre slug: ${slug}`);
  return g;
}

/** A known stored value — selectable or legacy. */
export function isGenreSlug(value: unknown): value is GenreSlug {
  return typeof value === "string" && GENRE_BY_SLUG.has(value as GenreSlug);
}

/** A value an admin (or the classifier) may newly assign. */
export function isSelectableGenre(value: unknown): value is GenreSlug {
  return isGenreSlug(value) && !getGenre(value).legacy;
}

export function isLegacyGenre(slug: GenreSlug): boolean {
  return getGenre(slug).legacy === true;
}

export function parentOf(slug: GenreSlug): GenreSlug | null {
  return getGenre(slug).parent ?? null;
}

export function subgenresOf(slug: GenreSlug): GenreSlug[] {
  return GENRES.filter((g) => g.parent === slug).map((g) => g.slug);
}

export function isMainGenre(slug: GenreSlug): boolean {
  return GENRES.some((g) => g.parent === slug);
}

/** Selectable genres grouped under their visual heading, in display order (empty groups omitted). */
export function genresByVisualGroup(): { group: VisualGroupDef; genres: GenreDef[] }[] {
  return VISUAL_GROUPS.map((group) => ({ group, genres: GENRES.filter((g) => g.visualGroup === group.slug) })).filter((x) => x.genres.length > 0);
}

/**
 * An event's direct tags plus every parent derived from them, each once —
 * "Hard Techno" yields ["hard-techno", "techno"]. Parents are derived here,
 * never stored.
 */
export function withDerivedParents(tags: readonly GenreSlug[]): GenreSlug[] {
  const out: GenreSlug[] = [];
  for (const tag of tags) {
    for (const slug of [tag, parentOf(tag)]) {
      if (slug && !out.includes(slug)) out.push(slug);
    }
  }
  return out;
}

/**
 * Genre classification storage (2026-11-02): `subgenres` is the single
 * source of truth for an event's genres — it is what every public surface
 * shows, filters and searches on. `primaryGenre` is kept as a column but is
 * only ever a mirror of `subgenres[0]`; every write path builds both fields
 * through genreFieldsFromTags so they can never diverge, and an event always
 * has at least one tag (Electronic / Other as the fallback).
 */
export const FALLBACK_GENRE: GenreSlug = "electronic-other";

export function genreFieldsFromTags(tags: readonly GenreSlug[]): { primaryGenre: GenreSlug; subgenres: GenreSlug[] } {
  const unique = [...new Set(tags)];
  const subgenres = unique.length > 0 ? unique : [FALLBACK_GENRE];
  return { primaryGenre: subgenres[0], subgenres };
}

/**
 * The genres an event actually shows, in order. Reads `subgenres`; falls
 * back to `primaryGenre` only for a row that has no subgenres at all. A
 * stored primaryGenre that disagrees with subgenres[0] is ignored.
 */
export function eventGenreTags(event: { primaryGenre?: GenreSlug | null; subgenres?: readonly GenreSlug[] | null }): GenreSlug[] {
  if (event.subgenres && event.subgenres.length > 0) return [...event.subgenres];
  return event.primaryGenre ? [event.primaryGenre] : [];
}

/**
 * Which genre tags an admin save stores, or null when it leaves the shown
 * genres as they are (then nothing is written or locked).
 *   - `subgenres` in the patch is the full, ordered classification (the
 *     event editor sends [primary, secondary]); a `primaryGenre` sent with
 *     it must equal its first entry.
 *   - `primaryGenre` alone (Add event from URL's single genre field) is an
 *     explicit choice of a new main genre: it replaces the whole
 *     classification, so an existing secondary genre is removed. Sending the
 *     genre the event already shows first changes nothing.
 * Rejected, so a caller error is never stored silently:
 *   - clearing every genre (an event always keeps at least one);
 *   - `subgenres` that is not a list;
 *   - a `primaryGenre` that contradicts `subgenres[0]` in the same patch.
 * Unknown or legacy values are rejected later by validateGenreTags.
 */
export function resolveAdminGenreTags(
  stored: { primaryGenre?: GenreSlug | null; subgenres?: readonly GenreSlug[] | null },
  patch: { primaryGenre?: unknown; subgenres?: unknown },
): GenreSlug[] | null {
  const sentSubgenres = "subgenres" in patch ? patch.subgenres : undefined;
  const sentPrimary = "primaryGenre" in patch ? patch.primaryGenre : undefined;
  if (sentSubgenres !== undefined && sentSubgenres !== null && !Array.isArray(sentSubgenres)) {
    throw new Error("subgenres must be a list of genres.");
  }
  const hasSubgenres = Array.isArray(sentSubgenres) && sentSubgenres.length > 0;
  const hasPrimary = typeof sentPrimary === "string" && sentPrimary.trim() !== "";
  const clearsSubgenres = "subgenres" in patch && !hasSubgenres;
  const clearsPrimary = "primaryGenre" in patch && sentPrimary !== undefined && !hasPrimary;
  if (!hasSubgenres && !hasPrimary) {
    if (clearsSubgenres || clearsPrimary) throw new Error("An event needs at least one genre.");
    return null;
  }
  const current = eventGenreTags(stored);
  let next: GenreSlug[];
  if (hasSubgenres) {
    next = [...new Set(sentSubgenres as GenreSlug[])];
    if (hasPrimary && sentPrimary !== next[0]) {
      throw new Error("primaryGenre must be the first genre in subgenres — send the genres as one ordered list.");
    }
  } else {
    if (sentPrimary === current[0]) return null;
    next = [sentPrimary as GenreSlug];
  }
  const unchanged = next.length === current.length && next.every((g, i) => g === current[i]);
  return unchanged ? null : next;
}

/**
 * The two stored genre fields form one lock: an admin genre decision covers
 * the whole classification, so a lock recorded under either name protects
 * both against sync (see override.ts). Existing rows that list only one of
 * the names are read as locking both — no stored overrides are rewritten.
 */
export const GENRE_LOCK_FIELDS = ["primaryGenre", "subgenres"] as const;

export function expandGenreLockGroup(fields: readonly string[]): string[] {
  const out = [...fields];
  if (GENRE_LOCK_FIELDS.some((f) => fields.includes(f))) {
    for (const f of GENRE_LOCK_FIELDS) if (!out.includes(f)) out.push(f);
  }
  return out;
}

/**
 * Old public filter values that name a SET of genres rather than one
 * genre. Each keeps exactly the meaning it had before the genre revision;
 * none is offered as a filter option (an active one shows as a hidden
 * option only). "ambient-experimental" also covers the legacy stored value.
 */
export const LEGACY_GENRE_FILTERS = {
  "garage-bass": { label: "UK Garage & Dubstep", genres: ["garage", "dubstep"] },
  "hardstyle-hardcore": { label: "Hardstyle & Hardcore", genres: ["hardstyle", "rawstyle", "hardcore"] },
  "ambient-experimental": { label: "Ambient & Experimental", genres: ["ambient", "experimental", "ambient-experimental"] },
} as const satisfies Record<string, { label: string; genres: readonly GenreSlug[] }>;

export type LegacyGenreFilter = keyof typeof LEGACY_GENRE_FILTERS;

/** What a genre filter can select: one selectable genre (by id) or a legacy set. */
export type GenreFilterValue = GenreSlug | LegacyGenreFilter;

export function isLegacyGenreFilter(value: unknown): value is LegacyGenreFilter {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_GENRE_FILTERS, value);
}

export function isGenreFilterValue(value: unknown): value is GenreFilterValue {
  return isLegacyGenreFilter(value) || isSelectableGenre(value);
}

export function genreFilterLabel(value: GenreFilterValue): string {
  return isLegacyGenreFilter(value) ? LEGACY_GENRE_FILTERS[value].label : getGenre(value).label;
}

/**
 * THE genre-matching rule, shared by every surface (homepage filter,
 * genre pages, search, newsletter):
 *   - a main genre matches itself and each of its subgenres;
 *   - any other genre matches only itself (exact) — plus, during the
 *     transition, events still carrying a legacy value that covers it
 *     (alsoMatches: an unreviewed "Ambient / Experimental" event shows
 *     under Ambient and under Experimental, never under neither);
 *   - a legacy set matches any genre in the set.
 * Returns a boolean per event, so an event tagged with two matching genres
 * still appears once in a filtered list.
 */
export function matchesGenreSelection(tags: readonly GenreSlug[], selection: GenreFilterValue): boolean {
  if (isLegacyGenreFilter(selection)) {
    const set: readonly GenreSlug[] = LEGACY_GENRE_FILTERS[selection].genres;
    return tags.some((t) => set.includes(t));
  }
  return tags.some((t) => t === selection || parentOf(t) === selection || (getGenre(t).alsoMatches?.includes(selection) ?? false));
}

/** Every genre a selection matches — the expanded set for e.g. SQL or docs. */
export function genresMatchedBy(selection: GenreFilterValue): GenreSlug[] {
  return GENRE_CATALOG.map((g) => g.slug).filter((slug) => matchesGenreSelection([slug], selection));
}

/** The URL value for a filter selection. */
export function genreFilterUrlValue(value: GenreFilterValue): string {
  return isLegacyGenreFilter(value) ? value : getGenre(value).urlSlug;
}

/**
 * Resolves a `?genre=` value: a selectable genre's urlSlug or alias, or a
 * legacy set. Legacy sets win over a same-named legacy stored genre
 * ("ambient-experimental"). Unknown values return null.
 */
export function parseGenreFilterUrlValue(raw: string | null | undefined): GenreFilterValue | null {
  if (!raw) return null;
  if (isLegacyGenreFilter(raw)) return raw;
  const genre = GENRES.find((g) => g.urlSlug === raw || g.urlAliases?.includes(raw));
  return genre ? genre.slug : null;
}

export type GenreTagProblem =
  | { kind: "too-many" }
  | { kind: "duplicate"; genre: GenreSlug }
  | { kind: "unknown"; value: string }
  | { kind: "legacy"; genre: GenreSlug }
  | { kind: "parent-and-subgenre"; parent: GenreSlug; subgenre: GenreSlug }
  | { kind: "fallback-combined" };

/**
 * Classification rules for an event's direct tags (approved model):
 *   - at most two tags, no duplicates, only known selectable genres;
 *   - never a main genre together with one of its own subgenres (the
 *     subgenre already carries that musical dimension) — two subgenres of
 *     the same main genre are fine;
 *   - Electronic / Other only ever on its own.
 * Legacy values are allowed only when `allowLegacy` lists them (an
 * existing stored value the edit left untouched).
 */
export function validateGenreTags(tags: readonly string[], allowLegacy: readonly string[] = []): GenreTagProblem[] {
  const problems: GenreTagProblem[] = [];
  if (tags.length > 2) problems.push({ kind: "too-many" });
  const seen = new Set<string>();
  for (const tag of tags) {
    if (seen.has(tag)) problems.push({ kind: "duplicate", genre: tag as GenreSlug });
    seen.add(tag);
    if (!isGenreSlug(tag)) problems.push({ kind: "unknown", value: tag });
    else if (isLegacyGenre(tag) && !allowLegacy.includes(tag)) problems.push({ kind: "legacy", genre: tag });
  }
  const known = tags.filter(isGenreSlug);
  for (const tag of known) {
    const parent = parentOf(tag);
    if (parent && known.includes(parent)) problems.push({ kind: "parent-and-subgenre", parent, subgenre: tag });
  }
  if (known.includes("electronic-other") && new Set(tags).size > 1) problems.push({ kind: "fallback-combined" });
  return problems;
}

export function describeGenreTagProblem(p: GenreTagProblem): string {
  switch (p.kind) {
    case "too-many":
      return "An event can have at most two genres.";
    case "duplicate":
      return `${getGenre(p.genre).label} is selected twice.`;
    case "unknown":
      return `Unknown genre "${p.value}".`;
    case "legacy":
      return `${getGenre(p.genre).label} can no longer be selected — choose a current genre.`;
    case "parent-and-subgenre":
      return `${getGenre(p.subgenre).label} already belongs to ${getGenre(p.parent).label} — pick the subgenre alone or with a genre from another family.`;
    case "fallback-combined":
      return "Electronic / Other is a fallback and can't be combined with another genre.";
  }
}

/**
 * Server-side check for an admin genre edit: the tags the save would store,
 * validated with the event's CURRENT tags allowed as legacy (an untouched
 * legacy value may stay; it just can't be newly chosen). Returns a
 * human-readable error, or null when the edit is valid. Callers run this
 * only when the save actually changes a genre field, so an existing
 * admin-locked combination never blocks an unrelated edit.
 */
export function genreEditError(nextTags: readonly string[], currentTags: readonly string[]): string | null {
  const problems = validateGenreTags(nextTags, currentTags);
  return problems.length > 0 ? problems.map(describeGenreTagProblem).join(" ") : null;
}

/** Whether `candidate` may be added as the second tag next to `primary`. */
export function isValidSecondaryGenre(primary: GenreSlug, candidate: GenreSlug): boolean {
  return candidate !== primary && validateGenreTags([primary, candidate], [primary]).length === 0;
}

/**
 * THE allowlist of public, indexable genre landing pages (SEO pilot,
 * 2026-10-09; Techno, House and Trance approved 2026-10-31). A genre never
 * gets a page automatically — adding one here is an explicit, separately
 * approved SEO decision, and needs its editorial copy in
 * src/lib/genrePages.ts. The single /genres/[slug] route only generates
 * allowlisted slugs (dynamicParams = false), so every other /genres/* URL
 * is a real HTTP 404. The sitemap's genre entries, the footer's genre
 * links and the genre-badge links are all derived from this list. A
 * main genre's page lists the genre and its subgenres
 * (matchesGenreSelection), exactly like the homepage filter.
 */
export const INDEXABLE_GENRE_PAGES = ["techno", "house", "trance"] as const satisfies readonly GenreSlug[];
export type IndexableGenre = (typeof INDEXABLE_GENRE_PAGES)[number];

const GENRES_WITH_PAGES: ReadonlySet<GenreSlug> = new Set<GenreSlug>(INDEXABLE_GENRE_PAGES);

/** The allowlisted genre a `/genres/[slug]` URL segment names, or null (→ 404). */
export function indexableGenreForUrlSlug(urlSlug: string): IndexableGenre | null {
  return INDEXABLE_GENRE_PAGES.find((slug) => getGenre(slug).urlSlug === urlSlug) ?? null;
}

/** Every approved genre page path, for the sitemap. */
export function indexableGenrePagePaths(): string[] {
  return INDEXABLE_GENRE_PAGES.map((slug) => genrePagePath(slug)!);
}

export function genrePagePath(slug: GenreSlug): string | null {
  return GENRES_WITH_PAGES.has(slug) ? `/genres/${getGenre(slug).urlSlug}` : null;
}

/**
 * The landing page a display genre badge links to: the page for that exact
 * genre, if it has one — the "Techno" badge links to /genres/techno, while
 * "Melodic Techno" or "Industrial" stay plain text until they get a page of
 * their own.
 */
export function genreLabelPagePath(slug: GenreSlug): string | null {
  return genrePagePath(slug);
}

/**
 * Public-facing genre badge(s) for an event: the exact stored genre(s),
 * verbatim ("Deep House", never its parent "House") — parents are derived
 * for filtering only, never shown in place of the more precise tag.
 * Deduplicates by slug and caps at `max` entries.
 */
export function displayGenres(subgenres: readonly GenreSlug[], max = 2): GenreDef[] {
  const seen = new Set<GenreSlug>();
  const result: GenreDef[] = [];

  for (const slug of subgenres) {
    if (result.length >= max) break;
    if (seen.has(slug)) continue;
    seen.add(slug);
    result.push(getGenre(slug));
  }

  return result;
}

/**
 * Newsletter genre preferences (genre system revision): a short list of
 * broad choices built on the same model and the same matching rule
 * (matchesGenreSelection) — main genres include their subgenres, the three
 * legacy sets keep their meaning. Stored values from the earlier 12-group
 * model stay valid: every one of them is a GenreFilterValue, so existing
 * preferences need no migration ("hard-techno" and "psytrance" are still
 * accepted and shown when stored, but no longer offered — Techno and
 * Trance now include them).
 */
export const NEWSLETTER_GENRE_OPTIONS: readonly GenreFilterValue[] = [
  "techno",
  "house",
  "disco",
  "trance",
  "drum-and-bass",
  "breakbeat",
  "garage-bass",
  "hardstyle-hardcore",
  "electro",
  "industrial",
  "ambient-experimental",
  "electronic-other",
];

/** Values from the earlier 12-group newsletter model that are no longer offered but stay valid. */
const NEWSLETTER_LEGACY_VALUES: readonly GenreFilterValue[] = ["hard-techno", "psytrance"];

export function isNewsletterGenreValue(value: unknown): value is GenreFilterValue {
  return (
    typeof value === "string" &&
    ((NEWSLETTER_GENRE_OPTIONS as readonly string[]).includes(value) || (NEWSLETTER_LEGACY_VALUES as readonly string[]).includes(value))
  );
}

export function newsletterGenreLabel(value: GenreFilterValue): string {
  return genreFilterLabel(value);
}
