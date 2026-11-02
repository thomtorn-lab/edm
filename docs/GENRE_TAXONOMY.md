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
- Alle andre genrer matcher kun sig selv. Undtagelse i overgangsperioden: et event, der stadig har legacy-værdien Ambient / Experimental, vises under både Ambient og Experimental, så det aldrig er skjult for alle genrevalg, før det er gennemgået.
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

## 4. SEO – kvalitetssikring (2026-10-30) og uændret politik

### 4.1 Central allowlist og fælles genreside (opdateret 2026-10-31)
`INDEXABLE_GENRE_PAGES` i `src/lib/taxonomy.ts` er den eneste liste over offentlige, indekserbare genresider. Den indeholder **Techno, House og Trance**.
- **Én route:** `src/app/genres/[slug]/page.tsx` serverer alle tre. Den genererer kun allowlistede slugs, og med `dynamicParams = false` er alle andre `/genres/*`-URL'er ægte HTTP 404 med noindex. Siden kalder desuden `notFound()` for ukendte slugs.
- **Tekster** (H1, SEO-title, description, introduktion) ligger i `src/lib/genrePages.ts`. Filen er knyttet til de eksisterende genre-ID'er og er ikke en separat taksonomi. Sætningen "includes …" og eventlisten kommer fra den fælles hierarkiske filterfunktion (`matchesGenreSelection`).
- **Metadata:** hver side har self-canonical og Open Graph/Twitter-metadata.
- **Interne links:** footer-links til de tre sider, et "More genres"-link mellem siderne og genremærker (Techno, House, Trance), der linker til deres side. Alt udledes af allowlisten. Sitemap'et lister præcis de tre sider.
- **En ny side** kræver en post i allowlisten og tekst i `genrePages.ts` (TypeScript håndhæver det sidste). Begge dele er en særskilt godkendt SEO-beslutning.
- **Tests:** `src/app/genres/genreRoutes.test.ts`, `src/app/genres/[slug]/page.test.tsx`, `sitemap.test.ts`, `Footer.test.tsx`.

### 4.2 Verificeret på et lokalt produktionsbuild
Lokal Postgres, ingen Production-adgang.

| URL | HTTP | title | canonical | robots | H1 |
|---|---|---|---|---|---|
| `/genres/techno` | 200 | Techno Events in Copenhagen \| Electronic CPH | `https://www.electroniccph.com/genres/techno` | (ingen → index) | Techno Events in Copenhagen |
| `/genres/techno` (tom database) | 200 | samme | samme | (ingen) | samme + tom tilstand "No upcoming techno events listed" |
| `/genres/house`, `/genres/industrial`, `/genres/industrial-techno`, `/genres/uk-garage`, `/genres/garage`, `/genres/bass-breaks`, `/genres/hard-dance`, `/genres/ambient-experimental`, `/genres/techno/extra` | **404** | standardtitel | ingen | **noindex** | Page not found |
| `/?genre=garage`, `garage-bass`, `hardstyle-hardcore`, `ambient-experimental`, `polka` | 200 | forsidens | `https://www.electroniccph.com` | (ingen) | Electronic music in Copenhagen |

- Description på `/genres/techno`: "Upcoming techno events in Copenhagen: club nights and concerts tagged techno or a techno subgenre, listed by date."
- Sitemap: præcis én genre-URL (`/genres/techno`) og ingen URL med `?` eller `#`.
- `robots.txt`: uændret (`Disallow: /admin`, `/api/`).
- Forsidens canonical, `robots.ts` og `layout.tsx` er uændrede i denne PR.

### 4.3 Techno-sidens indhold, før og efter
**Datagrundlag:** read-only Production-snapshot 2026-10-24 kl. 12:50 UTC (inspect-source run 40095581932). Det er den eneste Production-kilde. Nye tal kræver en read-only databaserolle, som endnu ikke findes. Tallene er "kommende publicerede events" på snapshot-tidspunktet.

| | Antal kommende events |
|---|---|
| **Før** (Production i dag, #161: kun eksakt Techno) | **35** |
| **Efter** (denne PR: Techno + undergenrer, ikke Industrial) | **40** |
| Heraf bidrag fra Hard Techno | +2 |
| Heraf bidrag fra Minimal Techno | +3 |
| Heraf bidrag fra Melodic, Industrial og Hypnotic Techno | +0 (de to sidste findes først efter denne PR) |
| Industrial alene (ikke med, før eller efter) | 6 (det 7. Industrial-event har også Techno og er talt med) |

Ingen events i snapshottet har to techno-tags, så summen er eksakt og uden dubletter. Hvis en admin gennemfører R1-anbefalingerne, kommer Cassie Raptor (Hangaren) og Culture Box Black Box med (+2). NEW GAME+ er allerede talt via sit Techno-tag.

### 4.4 Interne links fra undergenre-mærker (kun anbefaling, ikke implementeret)
I dag linker kun mærket "Techno" til `/genres/techno`.

| Mulighed | Konsekvens |
|---|---|
| A. Undergenre-mærker (Hard Techno, Industrial Techno …) linker til `/genres/techno` | Flere interne links til siden. Men ankerteksten ("Hard Techno") lover en side, der ikke findes, og linkene skal laves om, hvis en undergenreside senere godkendes |
| B. **Anbefalet:** behold mærkerne som tekst, og tilføj et separat link "More techno events in Copenhagen" på eventsider med en techno-familie-genre | Korrekt ankertekst og samme linkværdi. Kræver en lille UI-ændring på eventsiden |
| C. Ingen ændring | Ingen risiko, men ingen ekstra intern linkværdi |

### 4.5 Kendte svagheder (uændret, kræver godkendelse for at ændre)
1. Filtrerede forsidevisninger har andet indhold end canonical "/". Risikoen er lav, fordi filtrene ikke er crawlbare links. Forslag: overvåg i Search Console.
2. En ukendt `?genre=` giver 200 med en synlig besked (canonical "/"). Forslag: behold.

### 4.6 SEO-beslutninger, der fortsat kræver godkendelse
1. Nye genresider (fx House og Trance): post i `INDEXABLE_GENRE_PAGES` + route + sitemap. Forslag til kriterier: ≥10 kommende events på 90 dage, redaktionel intro og dokumenteret søgeefterspørgsel (Search Console).
2. Interne links fra undergenre-mærker (4.4).
3. Politik for tomme genresider ud over `/genres/techno` (bevidst ikke fastlagt).
4. Eventuelle redirects fra gamle eller alternative genre-URL'er (der laves ingen i denne PR).
5. Overvågning og eventuel håndtering af indekserede `?genre=`-URL'er (4.5).

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
| S1–S7 | `/genres/techno` (200, index, self-canonical, title/H1/description, også uden events), central allowlist (kun Techno), ingen dynamisk genre-route (ikke-godkendte = 404), sitemap kun fra allowlisten og uden parameter-URL'er, forsidens canonical og robots uændret | `genres/techno/page.test.tsx`, `genres/genreRoutes.test.ts`, `sitemap.test.ts`, `page.test.tsx`, `robotsMeta.test.ts` |

## 6. Kilder til faglige valg

Psytrance under Trance ([Wikipedia: Psychedelic trance](https://en.wikipedia.org/wiki/Psychedelic_trance)) · Jungle under Drum & Bass ([Wikipedia: Jungle music](https://en.wikipedia.org/wiki/Jungle_music)) · Dubstep selvstændig ([Wikipedia: Dubstep](https://en.wikipedia.org/wiki/Dubstep)) · Breakbeat selvstændig ([Beatportal](https://www.beatportal.com/articles/492349-beatport-is-expanding-its-bass-genres)) · Rawstyle under Hardstyle ([Wikipedia: Hardstyle](https://en.wikipedia.org/wiki/Hardstyle)) · Hardcore adskilt fra Hard Techno ([Wikipedia: Mainstream hardcore](https://en.wikipedia.org/wiki/Mainstream_hardcore), [EDM Identity](https://edmidentity.com/2020/07/30/beatport-hard-techno)) · Industrial ≠ Industrial Techno ([Wikipedia: EBM](https://en.wikipedia.org/wiki/Electronic_body_music), [Wikipedia: Birmingham sound](https://en.wikipedia.org/wiki/Birmingham_sound)) · Hypnotic Techno ([Beatportal](https://www.beatportal.com/articles/440314-beatport-is-expanding-its-techno-categories)) · Electro selvstændig ([WDET](https://wdet.org/2020/05/14/these-kraftwerk-tracks-changed-music-and-detroit-history/)).
