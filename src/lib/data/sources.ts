import type { Source } from "../types";

/**
 * Source registry (spec sections 25-32, 42-43). Every external reference the
 * product uses is classified by role — DISCOVERY / INGESTION / VERIFICATION
 * / LINK — independently, because the strongest discovery source is not
 * automatically the strongest ingestion source. Resident Advisor, Facebook,
 * Eventbrite and (until access is confirmed) Billetto and AllEvents are
 * deliberately NOT wired for automated ingestion per spec sections 26-30 and
 * 59 — do not add scraping for them without documenting a permitted access
 * method here first.
 */
export const SOURCES: Source[] = [
  // ---- First-party venues/promoters: highest verification priority, only sources with a working adapter ----
  {
    id: "src-culture-box",
    sourceName: "Culture Box",
    sourceType: "official-venue",
    baseUrl: "https://culture-box.com/",
    roles: ["discovery", "ingestion", "verification", "link"],
    // Real working adapter (src/lib/adapters/cultureBoxAdapter.ts): the
    // /events/ page's one ld+json block is generic Yoast SEO site metadata
    // (Organization/WebSite/WebPage), not per-event structured data, so
    // this is a DOM extraction, never a JSON feed as the label used to
    // (incorrectly) claim. robots.txt places no restriction on /events/.
    adapter: "culture-box-html",
    trustLevel: "high",
    autoPublish: true,
    syncFrequency: "every 6h",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote:
      "Real working adapter: fetches the unrestricted /events/ HTML page and parses its per-night/per-room structure. The venue rarely states a genre explicitly in its own show titles, so most nights land in the review queue (medium-confidence deterministic/Discogs lineup evidence) rather than auto-publishing — the quality gate never auto-publishes below high genre confidence, matching Hangaren's behavior. Recurring updates to already-known events apply automatically, respecting manual overrides. Not yet run against production — health fields will populate on the first real sync.",
  },
  {
    id: "src-hangaren",
    sourceName: "Hangaren",
    sourceType: "official-venue",
    baseUrl: "https://www.hangaren.dk/events",
    roles: ["discovery", "ingestion", "verification", "link"],
    // The only source with a real, working adapter as of this task (see
    // src/lib/adapters/hangarenAdapter.ts). No JSON/ICS feed is permitted —
    // robots.txt explicitly disallows `?format=json`/`?format=ical` for all
    // crawlers, AI crawlers named individually — but the plain `/events`
    // HTML page is not disallowed, is server-rendered (no JS execution
    // needed), and carries semantic `<time datetime>` tags plus a Google
    // Calendar link with exact UTC start/end instants for every event.
    adapter: "hangaren-html",
    trustLevel: "high",
    autoPublish: true,
    syncFrequency: "every 6h",
    active: true,
    lastSuccessfulSync: "2026-08-13T06:30:00+02:00",
    lastAttemptedSync: "2026-08-13T06:30:00+02:00",
    lastError: null,
    eventsFound: 9,
    eventsUpdated: 1,
    integrationNote:
      "Real working adapter: fetches the permitted plain /events HTML page (never the robots.txt-disallowed ?format=json/?format=ical export). No explicit genre metadata field exists on the source, so new events land in the review queue (medium-confidence deterministic genre mapping) rather than auto-publishing — the quality gate never auto-publishes below high genre confidence. Recurring updates to already-known events (date/time/lineup changes) apply automatically, respecting manual overrides.",
  },
  {
    id: "src-das",
    sourceName: "Den Anden Side",
    sourceType: "official-venue",
    baseUrl: "https://www.denandenside.com/",
    roles: ["discovery", "ingestion", "verification", "link"],
    adapter: "first-party-json",
    trustLevel: "high",
    autoPublish: true,
    syncFrequency: "every 6h",
    active: true,
    lastSuccessfulSync: "2026-08-13T05:45:00+02:00",
    lastAttemptedSync: "2026-08-13T05:45:00+02:00",
    lastError: null,
    eventsFound: 8,
    eventsUpdated: 0,
    integrationNote:
      "Verified 2026-08-14: denandenside.com's own /club-events page carries no event listing content — it defers entirely to Resident Advisor (ra.co/clubs/205134) for both discovery and ticketing. Not currently viable as a first-party ingestion source despite the 'official-venue' classification; re-evaluate if their site changes.",
  },
  {
    id: "src-gravity",
    sourceName: "Gravity Copenhagen",
    sourceType: "official-venue",
    baseUrl: "https://gravitycph.dk/",
    roles: ["discovery", "ingestion", "verification", "link"],
    adapter: "first-party-json",
    trustLevel: "high",
    autoPublish: true,
    syncFrequency: "every 6h",
    active: true,
    // Deliberately degraded example — mirrors spec section 43's "0 events detected" case.
    lastSuccessfulSync: "2026-08-10T06:00:00+02:00",
    lastAttemptedSync: "2026-08-13T06:00:00+02:00",
    lastError: "0 events parsed from the last 3 attempts — likely page structure change, needs adapter review",
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "First-party events page. Currently degraded: treat as a possible markup change, never as a sign the venue is inactive.",
  },

  // ---- Candidate first-party venues evaluated 2026-08-18 (sourcing workstream, research-only pass) ----
  // Electronic music is not limited to a curated venue whitelist (spec:
  // relevant electronic events may occur at any Copenhagen venue) — these
  // four surfaced as the strongest additional first-party candidates after
  // Billetto. None has a written/verified adapter yet: this session's
  // network egress does not reach any of these domains (confirmed via
  // direct connectivity check, not assumed), so robots.txt permission,
  // rendering technology and page structure are all unconfirmed pattern
  // inference from search results only — never treat these as "working"
  // sources. Deliberately NOT added: Jolene (electronic-central, but no
  // first-party website exists at all — Instagram/Facebook only), KB18
  // (appears defunct, domain now redirects to unrelated content), Mayhem
  // (real venue, but noise/jazz/performance-art focused, not electronic),
  // Den Anden Side (already tracked as src-das — its current booking runs
  // through the Shotgun.live ticketing platform's JS widget/organizer-gated
  // API, reinforcing its existing "not currently viable" note).
  {
    id: "src-klub-werkstatt",
    sourceName: "Klub Werkstatt",
    sourceType: "official-venue",
    baseUrl: "https://klubwerkstatt.dk/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "medium",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote:
      "Strongest new candidate found: Refshaleøen club with electronic (techno/progressive house/experimental) as its core identity, running frequently. Its /event/<slug>/ URL pattern matches WordPress's \"The Events Calendar\" plugin, which typically ships a public JSON REST endpoint (wp-json/tribe/events/v1/events) and per-event ICS export — potentially a better integration than HTML scraping, like Hangaren's calendar export. Unconfirmed: this is a URL-pattern inference, not a verified fetch. Before writing an adapter: directly check klubwerkstatt.dk/robots.txt and whether wp-json/tribe/events/v1/events actually responds.",
  },
  {
    id: "src-poolen",
    sourceName: "Poolen",
    sourceType: "official-venue",
    baseUrl: "https://poolen.dk/",
    roles: ["discovery", "ingestion", "verification", "link"],
    // Real working adapter (src/lib/adapters/poolenAdapter.ts), built and
    // tested against genuinely captured pages (see
    // src/lib/adapters/__fixtures__/poolen-*.html) after this session's own
    // network egress was confirmed unable to reach the domain directly.
    // robots.txt itself was not independently fetched/confirmed — the
    // fixtures prove the plain pages are publicly servable, not that
    // automated crawling is explicitly permitted; the adapter uses the same
    // identifying user-agent and single-retry courtesy as Hangaren/Culture
    // Box regardless. Worth a direct robots.txt check before trusting this
    // at full 6h cadence long-term.
    adapter: "poolen-html",
    trustLevel: "high",
    autoPublish: true,
    syncFrequency: "every 6h",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote:
      "Real working adapter, two-stage: the programme page (poolen.dk/da/) lists every upcoming show with a title, date and a link to its own detail page, but doors/show time, price, full description and support lineup only exist on that per-event page — the adapter fetches the programme page once, then every listed event's own detail page. Poolen is NOT an electronic-only venue (its programme mixes concerts, comedy/bingo nights, hip-hop, house/techno raves and more), so genre is decided per event from that event's own detail-page text, never assumed from the venue: a specific-subgenre keyword is credited high confidence (official-description tier, same as Hangaren/Culture Box's own bio text); an explicit but non-specific 'electronic'/'elektronisk' mention in that same first-party text is tagged the generic 'electronic-other' at the same tier rather than a guessed subgenre; anything short of that is left unresolved for the shared deterministic-mapping fallback and Discogs lineup enrichment to attempt, same as every other source. 'Outside' is Poolen's own outdoor extension of the same physical venue, not a separate one — its events are tagged venueName 'Poolen' (with 'Poolen Outside' registered as an alias), never an invented second venue. Some events are also Billetto-ticketed (see src-billetto's overlap note); dedup/idempotency relies on the existing shared pipeline (officialEventUrl-keyed sourceEventLinks), same as every other source. Not yet run against production — health fields will populate on the first real sync.",
  },
  {
    id: "src-pumpehuset",
    sourceName: "Pumpehuset",
    sourceType: "official-venue",
    baseUrl: "https://pumpehuset.dk/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "medium",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote:
      "Multi-genre venue (~300+ events/year) with a genre-filterable programme page (pumpehuset.dk/en/program/, filterable to \"Electronic\") — electronic is a real but minority strand of its booking, not its core identity, so coverage gain per unit of scraping/maintenance effort is lower than Poolen or Klub Werkstatt. Ticketing is split across Billetto/Ticketmaster/Livenation but the venue's own site appears to carry real per-event pages. Rendering technology and robots.txt unconfirmed from this session.",
  },
  {
    id: "src-bolsjefabrikken",
    sourceName: "Bolsjefabrikken",
    sourceType: "official-venue",
    baseUrl: "https://bolsjefabrikken.com/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "medium",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote:
      "Volunteer-run culture house on WordPress (bolsjefabrikken.com/wp/ — note bolsjefabrikken.dk is an unrelated housing association, not this venue) with a dedicated events page. Programme mixes electronic/underground club nights with board-game nights, workshops and film screenings, so electronic is present but not the venue's core identity; the events page may be a manually-formatted list rather than a queryable post type, lower confidence in clean parseability than Culture Box's WordPress setup. Lowest priority of the four candidates; confirm structure directly before building.",
  },

  // ---- Resident Advisor: primary discovery + secondary verification benchmark, no automated ingestion ----
  {
    id: "src-ra-copenhagen",
    sourceName: "Resident Advisor — Copenhagen",
    sourceType: "specialist-aggregator",
    baseUrl: "https://ra.co/events/dk/copenhagen",
    roles: ["discovery", "verification", "link"],
    adapter: null,
    trustLevel: "high",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "No automated scraping without explicit RA permission. Used manually as a coverage benchmark and for outbound links; URLs may be stored by hand.",
  },
  {
    id: "src-ra-techno",
    sourceName: "Resident Advisor — Techno Copenhagen",
    sourceType: "specialist-aggregator",
    baseUrl: "https://ra.co/events/dk/copenhagen/techno",
    roles: ["discovery", "verification", "link"],
    adapter: null,
    trustLevel: "high",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Coverage benchmark for techno/hard techno. Same access restrictions as the general RA Copenhagen source.",
  },
  {
    id: "src-ra-house",
    sourceName: "Resident Advisor — House Copenhagen",
    sourceType: "specialist-aggregator",
    baseUrl: "https://ra.co/events/dk/copenhagen/house",
    roles: ["discovery", "verification", "link"],
    adapter: null,
    trustLevel: "high",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Coverage benchmark for house/tech house/afro house. Same access restrictions as the general RA Copenhagen source.",
  },

  // ---- AllEvents: secondary discovery for long-tail/underground promoters ----
  {
    id: "src-allevents-edm",
    sourceName: "AllEvents — EDM Copenhagen",
    sourceType: "general-aggregator",
    baseUrl: "https://allevents.in/copenhagen/edm",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "medium",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Discovery only. Not treated as canonical — findings get verified against a first-party or official source before publishing.",
  },
  {
    id: "src-allevents-raves",
    sourceName: "AllEvents — Raves Copenhagen",
    sourceType: "general-aggregator",
    baseUrl: "https://allevents.in/copenhagen/raves",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "medium",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Discovery only, useful for independent/rave promoters underrepresented on RA.",
  },

  // ---- Billetto: ticketing discovery, verification-strength for date/venue/status ----
  {
    id: "src-billetto",
    sourceName: "Billetto — Copenhagen Electronic / EDM",
    sourceType: "ticketing",
    baseUrl: "https://billetto.dk/",
    roles: ["discovery", "verification", "link"],
    adapter: null,
    trustLevel: "medium",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    // Evaluated 2026-08-18 (research-only pass, no adapter written): Billetto
    // does have a real, documented public API (api.billetto.com/reference —
    // "search publicly available events", with a Denmark-specific endpoint
    // per its third-party Publisher Guide). It is NOT anonymous, though —
    // every endpoint requires an API key pair or OAuth credential, and
    // nothing available to this project confirms that credential is truly
    // instant/self-serve rather than gated behind a publisher relationship.
    // No such credential exists in this project yet, so this is a hold on
    // "credentials required that are not already available", not a rejection
    // of Billetto as a concept. Actual Copenhagen electronic-music coverage
    // is real but thin (Poolen/Teletech, Baile Techno, occasional Hangaren
    // and Culture Box listings) and overlaps venues already covered by
    // src-hangaren/src-culture-box — any future integration needs venue+
    // date+title dedup regardless. A public listing/category page also
    // exists (billetto.dk/en/c/koebenhavn-l/music-c/<genre>-sc) that in
    // principle wouldn't need a credential, but its robots.txt permission
    // and page structure (server-rendered HTML vs JS, JSON-LD presence) are
    // unconfirmed. Next step if revisited: either obtain an API credential
    // (ask the user first — this is a real external account/credential, not
    // something to self-provision) or directly verify the public listing
    // page's robots.txt and structure from a network-unrestricted
    // environment before writing any adapter.
    integrationNote:
      "Phase 1 diagnosis COMPLETE (2026-08-20, Electronic CPH ingestion task), four live GitHub Actions passes (sandbox network egress cannot reach billetto.dk at all — every request ran from a real runner). Passes 1-2: secrets missing, then present but rejected (401 Invalid credentials); ruled out wrong-host (api.billetto.com is Billetto's ReadMe.io docs portal, not a live API — billetto.dk is the real host, per the task brief). After the user re-verified the key pair, auth succeeded. SCHEMA (GET /api/v3/public/events, Api-Keypair header, after-cursor pagination confirmed working): each event has id, title, description, url/branded_url (carries utm_* tracking params — normalizeUrl in dedup.ts already strips these), image_link, availability, organiser{id,name}, minimum_price{amount_in_cents,currency}, startdate/enddate (ISO UTC), headliners{data:[{name,...}]} (artist lineup), categorization{category,subcategory,type,+_localized}, location{location_name,address_line,city,postal_code,country,country_code,region,subregion,coordinates{lat,lng}}. No explicit soldout/cancelled field beyond `availability`(bool) and `state`(e.g. \"published\"); no last-modified timestamp field observed. COPENHAGEN FILTER: q=/search=/keyword=/term=/query=/name= are ALL ignored server-side (identical results regardless of query text — no free-text search on this endpoint, so any future title-based overlap lookup must paginate + filter client-side, not rely on a search param). city=/region=/subregion= DO filter server-side: city=Copenhagen (English) is narrow (7/100), city=København is broad but auto-matches postal-suffix variants (K/S/V/N), region=Hovedstaden is TOO BROAD (pulls in Bornholm, Helsingør, Hillerød — the whole Capital Region, ~50km+ out) and must not be used alone. subregion=Byen%20København is the best precise match (Copenhagen city proper) and its result set's cities are exactly København + Frederiksberg — matching this codebase's own Venue.city union type (\"Copenhagen\" | \"Frederiksberg\") almost exactly; recommended: subregion=Byen København as the primary API filter, plus a conservative client-side check that location.city starts with \"København\" or is \"Frederiksberg\" (belt-and-suspenders per the task brief's fallback guidance). ELECTRONIC CLASSIFICATION: category=music is a real, working filter; its own subcategory taxonomy (evidence source A, official-source-metadata, highest tier per classification.ts) includes explicit techno, house, electro, edm_electronic and trance — direct, deterministic, no keyword guessing needed. CAUTION found live: subcategory=hardcore is ambiguous — the one Copenhagen hardcore-tagged event pulled in this pass (\"KÆMPE MOSHPIT VOL. 11\" @ UnderWerket) is hardcore PUNK, not hardcore techno; hardcore must never be trusted as electronic evidence without title/description corroboration (source B/C fallback), exactly the false-positive risk the task brief warned about. disco is similarly borderline (funk/retro framing common) — treat as medium confidence, not auto-publish tier. SAMPLE: 337 nationwide category=music events fully paginated (4 pages, reached natural end) plus ~500 additional unfiltered/city-filtered/search-probe events across earlier passes. QUALIFYING Copenhagen electronic examples found live: \"Infected Mushroom – 30th Anniversary Tour\" (Poolen, subcategory=trance, organiser=\"EDM Copenhagen\", headliner=\"Infected Mushroom\", 2026-10-03), \"Dance x Sauna\" and \"KLUB Rört\" (Rört, subcategory=house), \"EleKtro Universal: Mini Festival\" (subcategory=techno). CORRECTLY REJECTED non-electronic examples: \"Mellem Os Sagt\" (storytelling night), \"Saunagus\" (mobile sauna wellness), and the moshpit/hardcore-punk event above despite its music/hardcore tag. OVERLAP RESULTS: Poolen's \"Infected Mushroom\" — CONFIRMED live on Billetto (event id 1879852, url billetto.dk/e/infected-mushroom-30th-anniversary-tour-billetter-1879852). Reasoned against the real dedup.ts logic (no DB access this session, so not run against live Production rows): Poolen's own adapter (poolenAdapter.ts) populates ticketUrl from the venue's own ticket link, which for a Billetto-ticketed show IS this exact Billetto URL — normalizeUrl() already strips Billetto's utm_* params, so sharedUniqueUrl() would match cleanly on that ticketUrl/officialEventUrl pair, both resolve to the same venueId, headliners overlap (\"Infected Mushroom\" on both sides) so conflictingHeadliners is false -> assessDuplicate returns confidence \"high\" -> decideDuplicateAction \"auto_merge_if_safe\": this candidate would correctly attach to the existing event, not create a duplicate, PROVIDED Production's stored Poolen record's ticketUrl is in fact this Billetto link (needs a real DB read to fully confirm — flagged as the one unverified assumption). Hangaren's \"Arcanum Collective: POSSESSED\" — NOT found: absent from the full 337-event nationwide category=music feed by title or organiser name. Either not currently Billetto-ticketed, already occurred/removed from the public feed, or listed under a non-music category (none of the other categories seen — business, community, hobbies, health_wellness, performing_arts, sports, travel, auto_boat, lifestyle, school — plausibly fit a club night). Not a dedup-model failure; simply no live candidate exists to test against right now.",
  },

  // ---- Eventbrite: supplemental discovery only ----
  {
    id: "src-eventbrite",
    sourceName: "Eventbrite — Copenhagen Rave",
    sourceType: "general-aggregator",
    baseUrl: "https://www.eventbrite.dk/d/denmark--copenhagen/rave-party/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "low",
    autoPublish: false,
    syncFrequency: "manual coverage check",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Lower-priority supplemental discovery. Only permitted API/integration methods should ever be used, never scraping in violation of Eventbrite's terms.",
  },

  // ---- Facebook groups: discovery / gap-filling only, never a critical dependency ----
  {
    id: "src-fb-techno-events-cph",
    sourceName: "Facebook — Techno Events Copenhagen",
    sourceType: "social",
    baseUrl: "https://www.facebook.com/groups/technoeventscopenhagen/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "low",
    autoPublish: false,
    syncFrequency: "manual",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Manual/admin-assisted discovery only. No auth bypass or anti-bot circumvention.",
  },
  {
    id: "src-fb-electronic-music-cph",
    sourceName: "Facebook — Electronic Music Copenhagen",
    sourceType: "social",
    baseUrl: "https://www.facebook.com/groups/264600830563590/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "low",
    autoPublish: false,
    syncFrequency: "manual",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Manual/admin-assisted discovery only.",
  },
  {
    id: "src-fb-minimal-events",
    sourceName: "Facebook — Copenhagen Minimal Events",
    sourceType: "social",
    baseUrl: "https://www.facebook.com/groups/copenhagen.minimal.events/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "low",
    autoPublish: false,
    syncFrequency: "manual",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Manual/admin-assisted discovery only.",
  },
  {
    id: "src-fb-wonderful-electronic",
    sourceName: "Facebook — Wonderful Electronic Copenhagen",
    sourceType: "social",
    baseUrl: "https://www.facebook.com/groups/187120494682590/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "low",
    autoPublish: false,
    syncFrequency: "manual",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Manual/admin-assisted discovery only.",
  },
  {
    id: "src-fb-techhagen",
    sourceName: "Facebook — Techhagen Tech Scene",
    sourceType: "social",
    baseUrl: "https://www.facebook.com/groups/371329669614338/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "low",
    autoPublish: false,
    syncFrequency: "manual",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Manual/admin-assisted discovery only.",
  },
  {
    id: "src-fb-denmark-electronic-parties",
    sourceName: "Facebook — Denmark Electronic Parties",
    sourceType: "social",
    baseUrl: "https://www.facebook.com/groups/7906566894/",
    roles: ["discovery"],
    adapter: null,
    trustLevel: "low",
    autoPublish: false,
    syncFrequency: "manual",
    active: true,
    lastSuccessfulSync: null,
    lastAttemptedSync: null,
    lastError: null,
    eventsFound: 0,
    eventsUpdated: 0,
    integrationNote: "Manual/admin-assisted discovery only.",
  },
];

export function getSourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}
