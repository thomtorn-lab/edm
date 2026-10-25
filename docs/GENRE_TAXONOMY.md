# Genre taxonomy and test contract

Godkendt model (genrerevision, 2026-10-24). Kilden i koden er `src/lib/taxonomy.ts`. Ingen andre filer hardcoder genreværdier eller hierarkiregler.

## 1. Begreber

| Begreb | Betydning |
|---|---|
| **Genre (tag)** | En gemt værdi på et event. Højst 2 pr. event (`primaryGenre` + højst én sekundær i `subgenres`). |
| **Hovedgenre** | En genre med undergenrer: Techno, House, Trance, Drum & Bass, Hardstyle. Den kan selv tagges. Som filter inkluderer den sine undergenrer. |
| **Undergenre** | En genre med præcis én forælder. Som filter er den eksakt. |
| **Selvstændig genre** | En genre uden forælder og uden børn. Som filter er den eksakt. |
| **Visuel gruppe** | Kun en overskrift i valglister (`<optgroup>`). Den er aldrig et filter, en URL, en SEO-side eller en gemt værdi. |
| **id / label / urlSlug** | Den gemte værdi (omdøbes aldrig), visningsnavnet og den offentlige URL-værdi (kan have aliaser). De tre holdes permanent adskilt. |

Overgenrer udledes altid af hierarkiet (`withDerivedParents`). De gemmes aldrig og optager aldrig en tagplads.

## 2. Taksonomi (27 genrer, der kan vælges, + 1 legacy-værdi)

| Visuel gruppe | Genre | id | urlSlug (aliaser) | Forælder |
|---|---|---|---|---|
| Techno | Techno | `techno` | `techno` | – (hovedgenre) |
| | Hard Techno | `hard-techno` | `hard-techno` | techno |
| | Industrial Techno | `industrial-techno` | `industrial-techno` | techno |
| | Hypnotic Techno | `hypnotic-techno` | `hypnotic-techno` | techno |
| | Melodic Techno | `melodic-techno` | `melodic-techno` | techno |
| | Minimal Techno | `minimal-techno` | `minimal-techno` | techno |
| House & Disco | House | `house` | `house` | – (hovedgenre) |
| | Deep House | `deep-house` | `deep-house` | house |
| | Tech House | `tech-house` | `tech-house` | house |
| | Progressive House | `progressive-house` | `progressive-house` | house |
| | Afro House | `afro-house` | `afro-house` | house |
| | Disco | `disco` | `disco` | – |
| Trance | Trance | `trance` | `trance` | – (hovedgenre) |
| | Psytrance | `psytrance` | `psytrance` | trance |
| Bass & Breaks | Drum & Bass | `drum-and-bass` | `drum-and-bass` | – (hovedgenre) |
| | Jungle | `jungle` | `jungle` | drum-and-bass |
| | Breakbeat | `breakbeat` | `breakbeat` | – |
| | UK Garage | `garage` | `uk-garage` (`garage`) | – |
| | Dubstep | `dubstep` | `dubstep` | – |
| Hard Dance | Hardstyle | `hardstyle` | `hardstyle` | – (hovedgenre) |
| | Rawstyle | `rawstyle` | `rawstyle` | hardstyle |
| | Hardcore | `hardcore` | `hardcore` | – |
| Electro & Experimental | Electro | `electro` | `electro` | – |
| | Industrial | `industrial` | `industrial` | – |
| | Ambient | `ambient` | `ambient` | – |
| | Experimental | `experimental` | `experimental` | – |
| Other | Electronic / Other | `electronic-other` | `electronic-other` | – (fallback, kun alene) |
| *(legacy)* | Ambient / Experimental | `ambient-experimental` | – | – (vises, men kan ikke vælges) |

**Gamle URL-værdier for flere genrer:** de matcher fortsat det, de betød før #161, og vises kun som et skjult valg, mens de er aktive.

| `?genre=` | Matcher |
|---|---|
| `garage-bass` | UK Garage, Dubstep |
| `hardstyle-hardcore` | Hardstyle, Rawstyle, Hardcore |
| `ambient-experimental` | Ambient, Experimental, legacy-værdien `ambient-experimental` |

## 3. Regler

**Filtrering** (`matchesGenreSelection`, én fælles funktion):
- En hovedgenre matcher sig selv og sine undergenrer.
- Alle andre genrer matcher kun sig selv.
- En legacy-værdi matcher sin mængde.
- Funktionen returnerer ét boolesk svar pr. event, så et event optræder aldrig to gange.
- Den bruges af forsidefiltret (desktop, mobil og URL), `/genres/techno`, fritekstsøgning (overgenrernes navne indgår) og nyhedsbrevet.

**Klassifikation** (`validateGenreTags`; admin-editor, admin-API og forslag til sekundær genre):
- Højst 2 genrer og ingen dubletter. Ukendte værdier og legacy-værdier afvises (en eksisterende, uændret legacy-værdi må dog blive stående).
- Aldrig en hovedgenre sammen med sin egen undergenre. To undergenrer fra samme hovedgenre er tilladt.
- Electronic / Other kun alene.
- Valideringen køres kun, når en gem-handling ændrer et genrefelt. Eksisterende admin-låste kombinationer bevares og blokerer ikke andre redigeringer.

**Automatisk klassifikation:**

| Kilde | Resultat |
|---|---|
| "industrial techno" | Industrial Techno |
| Løst "industrial" | Industrial, sikkerhed højst medium (sendes altid til review) |
| Techno-hint + løst "industrial" | Forbliver Techno |
| "hypnotic techno" | Hypnotic Techno (det løse ord "hypnotic" bruges ikke) |
| "breakbeat" / "nu skool breaks" | Breakbeat (det løse ord "breaks" bruges ikke) |
| "jungle music" eller Discogs-style Jungle | Jungle. En blandet liste ("… Drum & Bass, and Jungle") forbliver Drum & Bass |
| "ambient" | Ambient |
| "experimental" + electronic | Experimental |
| "hardcore techno" / gabber | Hardcore |

Legacy-værdien tildeles aldrig. En gammel Discogs-cache-post med legacy-værdien behandles som et cache-miss.

**Nyhedsbrev:**
- 12 brede valg på den fælles model: Techno, House, Disco, Trance, Drum & Bass, Breakbeat, UK Garage & Dubstep, Hardstyle & Hardcore, Electro, Industrial, Ambient & Experimental, Electronic / Other.
- Alle værdier fra den tidligere 12-gruppe-model er fortsat gyldige og vises, hvis de er gemt.
- Ingen migrering, ingen aktivering og ingen udsendelse.

## 4. SEO – uændret politik, kendte svagheder

**Uændret:**
- Forsidens `canonical: "/"` for alle filter-URL'er.
- `robots.ts` (blokerer kun `/admin` og `/api/`).
- `/genres/techno` som eneste genreside (self-canonical, i sitemap).
- Nye indekserbare sider kræver særskilt godkendelse (`GENRES_WITH_PAGES`).

**Tilsigtet indholdsændring:** `/genres/techno` inkluderer igen techno-undergenrer, men ikke Industrial. Intro og meta-description følger med.

**Svagheder og forslag** (ikke implementeret, kræver godkendelse):
1. Filtrerede forsidevisninger har andet indhold end canonical "/". Google kan ignorere en canonical mellem ikke-identiske sider. Risikoen er lav, fordi filtrene ikke er crawlbare links. Forslag: behold, og overvåg i Search Console, om `?genre=`-URL'er indekseres.
2. En ukendt `?genre=` giver 200 med en synlig besked (canonical "/"). Forslag: behold. En 404 ville ramme gamle delte links.
3. Sitemap hardcoder `/genres/techno` ved siden af `GENRES_WITH_PAGES`. Forslag: generér sitemap-posten fra `genrePagePath`, så der kun er én kilde.
4. Der er ingen dynamisk `/genres/[slug]`. Forslag til nye sider: en route, der kun gengiver slugs på listen og giver 404 for alt andet, og som bruger samme `matchesGenreSelection`. Kriterier: ≥10 kommende events på 90 dage, redaktionel intro og dokumenteret søgeefterspørgsel.

## 5. Testkontrakt (til QA)

| ID | Krav | Test |
|---|---|---|
| T1–T7 | 27 genrer, rækkefølge, unikke id/label/urlSlug, forældre, selvstændige, UK Garage-slug/alias, legacy, visuelle grupper | `src/lib/taxonomy.test.ts` |
| F1–F7 | Hovedgenrer inkluderer undergenrer; undergenrer og selvstændige er eksakte; Industrial uden for Techno; to undergenrer vises én gang | `taxonomy.test.ts`, `EventExplorer.test.tsx`, `genres/techno/page.test.tsx` |
| F8 | Aldrig dubletter (alle 27 valg × 27 events, alle genrepar på `/genres/techno`) | `EventExplorer.test.tsx`, `genres/techno/page.test.tsx` |
| F9–F14 | Legacy-URL'er, `garage`/`uk-garage`, ukendte værdier, skjulte valg | `taxonomy.test.ts`, `EventExplorer.urlState.test.tsx`, `explorerFilters.test.ts` |
| F15 | Fritekstsøgning følger hierarkiet | `src/lib/search.test.ts` |
| P1–P5 | #161-regression: samme genrer og rækkefølge som admin, øvrige filtre og URL-tilstand, mobilens kladde-flow, genremærker kun for præcis genre, tilsigtet ændring for hovedgenrer | eksisterende og opdaterede tests i `EventExplorer*.test.tsx`, `EventRow.test.tsx`, `events/[slug]/page.test.tsx` |
| K1 | Tekstklassifikation | `deterministicGenreMapping.test.ts` |
| K2 | Discogs-styles | `discogsGenreMapping.test.ts` |
| K3/K4 | Parregler i admin og API; eksisterende låste kombinationer bevares | `taxonomy.test.ts`, `db/writes.test.ts`, `admin/EventManager.test.tsx` |
| K5 | Industrial-loft; legacy-hint tildeles aldrig | `adapters/pipeline.test.ts` |
| K6 | Forslag til sekundær genre følger parreglerne | `secondaryGenreSuggestion.test.ts` |
| N | Nyhedsbrevets valg og bagudkompatibilitet | `taxonomy.test.ts`, `NewsletterPreferencesForm.test.tsx`, `newsletter/genreMatching.test.ts` |
| D3 | Statiske data og seed-data er gyldige | `src/lib/data/genreData.test.ts` |
| S1–S5 | `/genres/techno`, kun Techno-side, sitemap, canonical, robots uændret | `genres/techno/page.test.tsx`, `sitemap.test.ts`, `page.test.tsx`, `robotsMeta.test.ts` |

## 6. Kilder til faglige valg

Psytrance under Trance ([Wikipedia: Psychedelic trance](https://en.wikipedia.org/wiki/Psychedelic_trance)) · Jungle under Drum & Bass ([Wikipedia: Jungle music](https://en.wikipedia.org/wiki/Jungle_music)) · Dubstep selvstændig ([Wikipedia: Dubstep](https://en.wikipedia.org/wiki/Dubstep)) · Breakbeat selvstændig ([Beatportal](https://www.beatportal.com/articles/492349-beatport-is-expanding-its-bass-genres)) · Rawstyle under Hardstyle ([Wikipedia: Hardstyle](https://en.wikipedia.org/wiki/Hardstyle)) · Hardcore adskilt fra Hard Techno ([Wikipedia: Mainstream hardcore](https://en.wikipedia.org/wiki/Mainstream_hardcore), [EDM Identity](https://edmidentity.com/2020/07/30/beatport-hard-techno)) · Industrial ≠ Industrial Techno ([Wikipedia: EBM](https://en.wikipedia.org/wiki/Electronic_body_music), [Wikipedia: Birmingham sound](https://en.wikipedia.org/wiki/Birmingham_sound)) · Hypnotic Techno ([Beatportal](https://www.beatportal.com/articles/440314-beatport-is-expanding-its-techno-categories)) · Electro selvstændig ([WDET](https://wdet.org/2020/05/14/these-kraftwerk-tracks-changed-music-and-detroit-history/)).
