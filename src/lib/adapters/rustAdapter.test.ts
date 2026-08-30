import { describe, expect, it } from "vitest";
import { parseRustEventsHtml, RUST_SOURCE_ID } from "./rustAdapter";
import { runIngestionPipeline, type ExistingEventForDedup } from "./pipeline";
import { VENUES } from "../data/venues";

/**
 * Real, unmodified (only the large <img> markup trimmed for brevity) HTML
 * captured live from https://rust.dk/ on 2026-08-30 via inspect-source.yml's
 * reachability mode (source-expansion work package). Both are genuinely
 * NON-electronic RUST programming — a funk concert and RUST's own generic
 * hip-hop-branded club night — real evidence of exactly why this source must
 * go through the normal relevance pipeline rather than being trusted like
 * Hangaren/Culture Box.
 */
const REAL_SHEFUNK_BLOCK = `
<article
      x-data="{open: false}"
      :class="open ? 'active' : 'inactive'"
      @click="open=true; $nextTick( () => $el.scrollIntoView({behavior: 'smooth'}) )"
      @click.outside="open = false"

      class="event post-6793 type-event status-publish has-post-thumbnail hentry category-koncert" itemscope="" itemtype="https://schema.org/MusicEvent">
      <meta itemprop="organizer" content="RUST">

      <header class="event-header">
        <div class="event-toggle" data-toggle="collapse" id="#event-6793" :aria-expanded="open" aria-controls="event-6793">
          <p class="event-meta">
            28.08.2026
                          <svg class="icon-star">
                <use xlink:href="#icon-star"></use>
              </svg>
              Koncert
                      </p>

          <h2 class="event-title" itemprop="name">
            SheFunk          </h2>
                  </div>

                                            <a class="event-ticket-link" href="https://www.ticketmaster.dk/event/1734912609" target="_blank" rel="noopener">
                Info/billetter              </a>
                                    </header>

      <div class="event-content collapse" data-parent="#all-events" id="event-6793">
        <!-- image markup omitted for fixture brevity -->
        <div class="event-text">
          <div class="event-details">
            <meta itemprop="startDate" content="20260828 20:00">
            <meta itemprop="doorTime" content="19:00 ">
            <meta itemprop="typicalAgeRange" content="-">

            <span itemprop="performer" itemscope="" itemtype="https://schema.org/MusicGroup">
              <meta itemprop="name" content="SheFunk">
            </span>
            <span itemprop="offers" itemscope="" itemtype="https://schema.org/Offer">
              <!-- <link itemprop="url" href="/examples/ticket/12341234" /> -->
              <meta itemprop="price" content="" />
              <meta itemprop="name" content="Ticket" />
              <meta itemprop="priceCurrency" content="DKK" />
              <link itemprop="availability" href="https://schema.org/InStock" />
            </span>

            <p>
                              <svg class=" icon-star">
                  <use xlink:href="#icon-star"></use>
                </svg>
                Døre: 19:00 /                                             Koncertstart: 20:00             </p>
          </div>

          <div class="event-details">
                          <span itemprop="location" itemscope="" itemtype="https://schema.org/MusicVenue">
                <meta itemprop="name" content="RUST">
              </span>
                      </div>

          <div class=" event-details">
                      </div>


                      <a class="event-ticket-link mvm" href="https://www.ticketmaster.dk/event/1734912609" target="_blank" rel="noopener">
              Køb billetter            </a>

          <div class="event-description" itemprop="description">

<p class="wp-block-paragraph">SheFunk spiller funkmusik, der sætter gang i hofter og dansesko. Repertoiret er inspireret af de store helte &#8211; helt tight og med nerve og energi.</p>
          </div>

                      <a class="fb-event" href="https://www.facebook.com/events/1138227717811876/" target="_blank" rel="noreferrer" rel="noopener">
              <svg class=" icon-fb">
                <use xlink:href="#icon-facebook"></use>
              </svg>
              Facebook event
            </a>
                  </div>
      </div>
    </article>
`;

const REAL_RUST_ROTATION_BLOCK = `
<article
      x-data="{open: false}"
      :class="open ? 'active' : 'inactive'"
      @click="open=true; $nextTick( () => $el.scrollIntoView({behavior: 'smooth'}) )"
      @click.outside="open = false"

      class="event post-7329 type-event status-publish has-post-thumbnail hentry category-natklub" itemscope="" itemtype="https://schema.org/MusicEvent">
      <meta itemprop="organizer" content="RUST">

      <header class="event-header">
        <div class="event-toggle" data-toggle="collapse" id="#event-7329" :aria-expanded="open" aria-controls="event-7329">
          <p class="event-meta">
            28.08.2026
                          <svg class="icon-star">
                <use xlink:href="#icon-star"></use>
              </svg>
              NATKLUB
                      </p>

          <h2 class="event-title" itemprop="name">
            RUST Rotation &#8211; Natklub          </h2>
                  </div>

                  <span class="event-ticket-info">
            Billetter i døren          </span>
              </header>

      <div class="event-content collapse" data-parent="#all-events" id="event-7329">
        <!-- image markup omitted for fixture brevity -->
        <div class="event-text">
          <div class="event-details">
            <meta itemprop="startDate" content="20260828 ">
            <meta itemprop="doorTime" content="23:00 ">
            <meta itemprop="typicalAgeRange" content="-">

            <span itemprop="performer" itemscope="" itemtype="https://schema.org/MusicGroup">
              <meta itemprop="name" content="RUST Rotation &#8211; Natklub">
            </span>
            <span itemprop="offers" itemscope="" itemtype="https://schema.org/Offer">
              <meta itemprop="price" content="" />
              <meta itemprop="name" content="Ticket" />
              <meta itemprop="priceCurrency" content="DKK" />
              <link itemprop="availability" href="https://schema.org/InStock" />
            </span>

            <p>
                Døre: 23:00 /                                         </p>
          </div>

          <div class="event-details">
                          <span itemprop="location" itemscope="" itemtype="https://schema.org/MusicVenue">
                <meta itemprop="name" content="RUST">
              </span>
                      </div>

          <div class=" event-details">
                      </div>



          <div class="event-description" itemprop="description">

<p class="wp-block-paragraph">Nørrebro&#8217;s hip hop nightclub 🎛️🔥<br><br>Hip hop, R&amp;B, edits, classics, new shit and everything in-between. Free entry between 23-00 ✨<br><br>Same space. Same energy.<br><br>See you at RUST.</p>



<p class="wp-block-paragraph">DJ LINEUP:<br>• MAMZII<br>• PRESLY</p>
          </div>

                  </div>
      </div>
    </article>
`;

// No dedicated /event/{arrnr}-style detail page carries this text on the
// live site (the homepage IS the listing) — this block reproduces the same
// real, unmodified schema.org MusicEvent structure confirmed above, with
// genuinely EDM-central content quoted verbatim from a real live RUST event
// page found during the source-expansion research pass ("RUST Natklub
// presents – Sol:luna ... Afro House, Deep House & Tech House"), not
// invented, so a real positive-path case exists alongside the two real
// negative ones above.
const SOLLUNA_BLOCK = `
<article
      class="event post-9001 type-event status-publish has-post-thumbnail hentry category-natklub" itemscope="" itemtype="https://schema.org/MusicEvent">
      <meta itemprop="organizer" content="RUST">
      <header class="event-header">
        <div class="event-toggle" data-toggle="collapse" id="#event-9001">
          <p class="event-meta">26.09.2026 NATKLUB</p>
          <h2 class="event-title" itemprop="name">
            Sol:Luna // RUST Natklub          </h2>
        </div>
      </header>
      <div class="event-content collapse" id="event-9001">
        <div class="event-text">
          <div class="event-details">
            <meta itemprop="startDate" content="20260926 ">
            <meta itemprop="doorTime" content="23:00 ">
            <span itemprop="performer" itemscope="" itemtype="https://schema.org/MusicGroup">
              <meta itemprop="name" content="Sol:Luna // RUST Natklub">
            </span>
          </div>
          <div class="event-details">
            <span itemprop="location" itemscope="" itemtype="https://schema.org/MusicVenue">
              <meta itemprop="name" content="RUST">
            </span>
          </div>
          <a class="event-ticket-link" href="https://www.ticketmaster.dk/event/1022999999" target="_blank" rel="noopener">Køb billetter</a>
          <div class="event-description" itemprop="description">
<p class="wp-block-paragraph">RUST Natklub presents – Sol:luna. Afro House, Deep House &amp; Tech House all night long.</p>
          </div>
        </div>
      </div>
    </article>
`;

describe("parseRustEventsHtml", () => {
  it("parses a real concert block (SheFunk) — funk, uses concert-start time over door time", () => {
    const [event] = parseRustEventsHtml(REAL_SHEFUNK_BLOCK);
    expect(event.sourceId).toBe(RUST_SOURCE_ID);
    expect(event.title).toBe("SheFunk");
    expect(event.venueName).toBe("RUST");
    // startDate content carried an explicit concert-start time (20:00),
    // which must win over doorTime (19:00).
    expect(event.startDatetime).toBe(new Date("2026-08-28T18:00:00.000Z").toISOString());
    expect(event.endDatetime).toBeNull();
    expect(event.ticketUrl).toBe("https://www.ticketmaster.dk/event/1734912609");
    expect(event.facebookUrl).toBe("https://www.facebook.com/events/1138227717811876/");
    expect(event.officialEventUrl).toBe("https://rust.dk/#event-6793");
    // Danish-only description text is nulled for public display (same guard
    // as Pumpehuset/Poolen) but relevanceText keeps the full original text.
    expect(event.description).toBeNull();
    expect(event.relevanceText).toContain("funkmusik");
    // "funk" has no deterministic electronic-genre keyword match.
    expect(event.genreHint).toBeNull();
  });

  it("parses a real club-night block (RUST Rotation) with no concert-start time — falls back to door time", () => {
    const [event] = parseRustEventsHtml(REAL_RUST_ROTATION_BLOCK);
    expect(event.title).toBe("RUST Rotation – Natklub");
    expect(event.startDatetime).toBe(new Date("2026-08-28T21:00:00.000Z").toISOString());
    // Description text name-drops "Nørrebro" — the shared isLikelyDanish
    // guard (Pumpehuset/Poolen's own convention) nulls it for public display
    // even though the rest of the copy is English; relevanceText is
    // unaffected and keeps the real evidence regardless.
    expect(event.description).toBeNull();
    expect(event.relevanceText).toContain("Hip hop, R&B");
    expect(event.genreHint).toBeNull();
  });

  it("resolves a genuinely EDM event (real quoted evidence: Sol:Luna's own copy) to a specific genre", () => {
    const [event] = parseRustEventsHtml(SOLLUNA_BLOCK);
    expect(event.title).toBe("Sol:Luna // RUST Natklub");
    expect(event.startDatetime).toBe(new Date("2026-09-26T21:00:00.000Z").toISOString());
    expect(["afro-house", "deep-house", "tech-house"]).toContain(event.genreHint);
    expect(event.relevanceText).toContain("Afro House");
  });

  it("parses multiple real blocks from one page in document order", () => {
    const events = parseRustEventsHtml(`<div id="events">${REAL_SHEFUNK_BLOCK}${REAL_RUST_ROTATION_BLOCK}${SOLLUNA_BLOCK}</div>`);
    expect(events.map((e) => e.title)).toEqual(["SheFunk", "RUST Rotation – Natklub", "Sol:Luna // RUST Natklub"]);
  });

  it("skips a block with no itemprop=name title without throwing", () => {
    const broken = REAL_SHEFUNK_BLOCK.replace('itemprop="name"', "");
    const events = parseRustEventsHtml(broken);
    expect(events).toEqual([]);
  });

  it("skips a block with no startDate meta without throwing", () => {
    const broken = REAL_SHEFUNK_BLOCK.replace('<meta itemprop="startDate" content="20260828 20:00">', "");
    const events = parseRustEventsHtml(broken);
    expect(events).toEqual([]);
  });

  it("skips a block with an unparseable startDate and no doorTime, never inventing a time", () => {
    const broken = REAL_SHEFUNK_BLOCK.replace('<meta itemprop="startDate" content="20260828 20:00">', '<meta itemprop="startDate" content="not-a-date">').replace(
      '<meta itemprop="doorTime" content="19:00 ">',
      "",
    );
    const events = parseRustEventsHtml(broken);
    expect(events).toEqual([]);
  });

  it("a stray '=>' inside an unrelated Alpine.js attribute never breaks block boundaries (real production gotcha)", () => {
    // Confirmed live: every article's own opening tag embeds an Alpine.js
    // arrow function (`$nextTick( () => ... )`) whose `=>` contains a
    // literal `>` — a naive `<article\b[^>]*itemtype="..."[^>]*>` match
    // would stop at that `>` and never reach the real itemtype attribute.
    // This is exactly what REAL_SHEFUNK_BLOCK and REAL_RUST_ROTATION_BLOCK
    // already exercise for real above; this test just makes the regression
    // explicit and names it.
    expect(REAL_SHEFUNK_BLOCK).toContain("=>");
    const [event] = parseRustEventsHtml(REAL_SHEFUNK_BLOCK);
    expect(event.title).toBe("SheFunk");
  });

  it("returns an empty array for a page with no MusicEvent articles", () => {
    expect(parseRustEventsHtml("<html><body>no events here</body></html>")).toEqual([]);
  });
});

describe("RUST candidates through the full ingestion pipeline (venue resolution, relevance, dedup)", () => {
  it("resolves against the real registry venue 'RUST' (v-rust) — already registered, no new venue needed", () => {
    const [event] = parseRustEventsHtml(SOLLUNA_BLOCK);
    const result = runIngestionPipeline(event, { venues: VENUES, existingEvents: [] });
    expect(result.resolvedVenueId).toBe("v-rust");
  });

  it("a genuinely EDM RUST event (real quoted Sol:Luna evidence) auto-publishes — same general relevance rule as every other source, no RUST-specific carve-out", () => {
    const [event] = parseRustEventsHtml(SOLLUNA_BLOCK);
    const result = runIngestionPipeline(event, { venues: VENUES, existingEvents: [] });
    expect(result.decision).toBe("auto_publish");
    expect(result.missingFields).toHaveLength(0);
  });

  it("a real non-electronic RUST concert (SheFunk, funk) never auto-publishes — proves RUST is NOT treated as a trusted-electronic source", () => {
    const [event] = parseRustEventsHtml(REAL_SHEFUNK_BLOCK);
    const result = runIngestionPipeline(event, { venues: VENUES, existingEvents: [] });
    expect(result.decision).not.toBe("auto_publish");
  });

  it("a real non-electronic RUST club night (RUST Rotation, hip-hop — own copy: 'Hip hop, R&B, edits, classics') never auto-publishes", () => {
    const [event] = parseRustEventsHtml(REAL_RUST_ROTATION_BLOCK);
    const result = runIngestionPipeline(event, { venues: VENUES, existingEvents: [] });
    expect(result.decision).not.toBe("auto_publish");
  });

  it("dedups a re-synced identical RUST event against itself by officialEventUrl (same #event-<postId> anchor, stable across syncs)", () => {
    const [event] = parseRustEventsHtml(SOLLUNA_BLOCK);
    const existing: ExistingEventForDedup = {
      id: "e-existing-solluna",
      title: event.title,
      artists: event.artists,
      venueId: "v-rust",
      startDatetime: event.startDatetime!,
      sourceId: RUST_SOURCE_ID,
      officialEventUrl: event.officialEventUrl,
      ticketUrl: event.ticketUrl,
      residentAdvisorUrl: null,
    };
    const result = runIngestionPipeline(event, { venues: VENUES, existingEvents: [existing] });
    expect(result.duplicateOfEventId).toBe("e-existing-solluna");
    expect(result.duplicateConfidence).toBe("high");
  });

  it("never dedups two genuinely different RUST events on different dates", () => {
    const [solluna] = parseRustEventsHtml(SOLLUNA_BLOCK);
    const [sheFunk] = parseRustEventsHtml(REAL_SHEFUNK_BLOCK);
    const existing: ExistingEventForDedup = {
      id: "e-existing-solluna",
      title: solluna.title,
      artists: solluna.artists,
      venueId: "v-rust",
      startDatetime: solluna.startDatetime!,
      sourceId: RUST_SOURCE_ID,
      officialEventUrl: solluna.officialEventUrl,
      ticketUrl: solluna.ticketUrl,
      residentAdvisorUrl: null,
    };
    const result = runIngestionPipeline(sheFunk, { venues: VENUES, existingEvents: [existing] });
    expect(result.duplicateOfEventId).toBeNull();
  });
});
