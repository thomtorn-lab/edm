import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createCultureBoxAdapter, CULTURE_BOX_EVENTS_URL } from "@/lib/adapters/cultureBoxAdapter";
import { runIngestionPipeline } from "@/lib/adapters/pipeline";
import type { RawCandidateEvent, SourceAdapter } from "@/lib/adapters/types";
import { VENUES } from "@/lib/data/venues";
import type { ShadowDecision } from "@/lib/ticketReplacementShadow";
import { runTicketReplacementShadow } from "./ticketReplacementShadow";

/**
 * SYNTHETIC local evaluation of the ticket-replacement shadow rule
 * (thomtorn-lab/edm#145, 2026-10-23). Not an observation from Production.
 *
 * Base data: the committed, real Culture Box pages (listing + 15 detail
 * pages under src/lib/adapters/__fixtures__), run through the real adapter
 * and pipeline. A stored event is built for every night exactly as a sync
 * would have stored it, so the baseline is "all confirm", like the
 * 2026-10-23 Production run. Each scenario then applies ONE synthetic change
 * (a different stored ticket link, a moved date, per-room events, an admin
 * override, …) whose correct answer is known by construction (`truth`), and
 * runs the whole read-only runner: findSyncMatch/dedup, then the shadow
 * decision. A false positive is would_replace where truth is "withhold"; a
 * false negative is any other outcome where truth is "replace".
 *
 * A clean result here shows the rule behaves as designed on constructed
 * cases. It is NOT evidence of precision on real divergences.
 */

const FIXTURES = path.join(__dirname, "..", "lib", "adapters", "__fixtures__");
const NIGHTS = [
  "fri-21-august-2026", "sat-22-august-2026", "fri-28-august", "sat-29-august-2026",
  "fri-4-september-2026", "sat-5-september-2026", "fri-11-september-2026", "sat-12-september-2026",
  "fri-18-september-2026", "sat-19-september-2026", "fri-25-september-2026", "sat-26-september-2026",
  "fri-2-october-2026", "sat-3-october-2026", "fri-23-october-2026",
];
const NOW = new Date("2026-08-01T12:00:00.000Z");
const page = (slug: string) => `https://culture-box.com/event/${slug}/`;
const DAY = 24 * 3_600_000;
const shift = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();

type Row = Record<string, unknown>;
type Link = { event_id: string; source_url: string };

let realCandidates: RawCandidateEvent[] = [];

beforeAll(async () => {
  const html: Record<string, string> = { [CULTURE_BOX_EVENTS_URL]: readFileSync(path.join(FIXTURES, "culture-box-events.html"), "utf-8") };
  for (const slug of NIGHTS) html[page(slug)] = readFileSync(path.join(FIXTURES, `culture-box-detail-${slug}.html`), "utf-8");
  const fetchImpl = async (url: string | URL) => new Response(html[String(url)] ?? "", { status: html[String(url)] ? 200 : 404 });
  realCandidates = await createCultureBoxAdapter(fetchImpl as unknown as typeof fetch, 0, 0).fetchCandidates();
});

function candidate(slug: string): RawCandidateEvent {
  const c = realCandidates.find((x) => x.officialEventUrl === page(slug));
  if (!c) throw new Error(`no fixture candidate for ${slug}`);
  return { ...c };
}

const idOf = (slug: string) => `e-${slug}`;

/** The stored event a sync would have created for this night (baseline). */
function storedFor(slug: string, overrides: Row = {}): Row {
  const c = candidate(slug);
  const r = runIngestionPipeline(c, { venues: VENUES, existingEvents: [] });
  return {
    id: idOf(slug),
    title: c.title,
    artists: r.normalizedArtists,
    venue_id: r.resolvedVenueId,
    sub_venue: r.resolvedSubVenue,
    start_datetime: c.startDatetime,
    end_datetime: null,
    canonical_source_id: "src-culture-box",
    official_event_url: c.officialEventUrl,
    ticket_url: c.ticketUrl,
    resident_advisor_url: c.residentAdvisorUrl,
    overridden_fields: [],
    published: true,
    admin_unpublish_reason: null,
    ...overrides,
  };
}

async function run(rows: Row[], links: Link[], candidates: RawCandidateEvent[]) {
  const client = {
    async query(sql: string) {
      if (/FROM events/.test(sql)) return { rows };
      if (/FROM source_event_links/.test(sql)) return { rows: links };
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  const createAdapter = () => ({ sourceId: "src-culture-box", fetchCandidates: async () => candidates }) as unknown as SourceAdapter;
  return runTicketReplacementShadow(client, { sourceId: "src-culture-box", venues: VENUES, now: NOW, createAdapter });
}

interface Scenario {
  id: string;
  group: string;
  setup: string;
  /** Correct answer by construction: should the stored link be replaced by the incoming one? */
  truth: "replace" | "withhold";
  build: () => { rows: Row[]; links: Link[]; candidates: RawCandidateEvent[]; target: string };
  expected: { outcome: ShadowDecision["outcome"] | "not_assessed"; withheldReason?: ShadowDecision["withheldReason"] };
}

const OLD_TICKSTER = "https://www.tickster.com/dk/en/events/old-listing";
const NEW_TICKSTER = "https://www.tickster.com/dk/en/events/culture-box-new";

const SCENARIOS: Scenario[] = [
  {
    id: "S1",
    group: "Correct replacement, same event",
    setup: "Linked event; stored ticket link is an old Tickster page an aggregator filled in; Culture Box's own Tickets button now gives the night's RA page.",
    truth: "replace",
    build: () => ({ rows: [storedFor("sat-22-august-2026", { ticket_url: OLD_TICKSTER })], links: [{ event_id: idOf("sat-22-august-2026"), source_url: page("sat-22-august-2026") }], candidates: [candidate("sat-22-august-2026")], target: idOf("sat-22-august-2026") }),
    expected: { outcome: "would_replace" },
  },
  {
    id: "S2",
    group: "Correct replacement, same event",
    setup: "Linked event; Culture Box re-listed the night on RA, so the stored RA ticket id is outdated.",
    truth: "replace",
    build: () => ({ rows: [storedFor("fri-28-august", { ticket_url: "https://ra.co/events/1111111", resident_advisor_url: "https://ra.co/events/1111111" })], links: [{ event_id: idOf("fri-28-august"), source_url: page("fri-28-august") }], candidates: [candidate("fri-28-august")], target: idOf("fri-28-august") }),
    expected: { outcome: "would_replace" },
  },
  {
    id: "S3",
    group: "Correct replacement, same event",
    setup: "Event first created by another source (no Culture Box link, no official URL), same title and lineup, Billetto ticket link.",
    truth: "replace",
    build: () => ({ rows: [storedFor("sat-29-august-2026", { official_event_url: null, resident_advisor_url: null, ticket_url: "https://billetto.dk/e/x-123", canonical_source_id: "src-billetto" })], links: [], candidates: [candidate("sat-29-august-2026")], target: idOf("sat-29-august-2026") }),
    expected: { outcome: "would_replace" },
  },
  {
    id: "S4",
    group: "Correct replacement, same event",
    setup: "Same as S3, but the other source titled it differently (\"Specific Objects + guests\"). The sync does not match it at all.",
    truth: "replace",
    build: () => ({ rows: [storedFor("sat-29-august-2026", { title: "Specific Objects + guests", official_event_url: null, resident_advisor_url: null, ticket_url: "https://billetto.dk/e/x-123", canonical_source_id: "src-billetto" })], links: [], candidates: [candidate("sat-29-august-2026")], target: idOf("sat-29-august-2026") }),
    expected: { outcome: "not_assessed" },
  },
  {
    id: "S5",
    group: "Different events sharing a ticket page",
    setup: "Stored Fri and Sat both carry the same weekend-pass link (copied by an aggregator); Culture Box gives Friday its own RA page.",
    truth: "replace",
    build: () => ({
      rows: [storedFor("fri-4-september-2026", { ticket_url: "https://tickets.example/weekend-pass" }), storedFor("sat-5-september-2026", { ticket_url: "https://tickets.example/weekend-pass" })],
      links: [{ event_id: idOf("fri-4-september-2026"), source_url: page("fri-4-september-2026") }],
      candidates: [candidate("fri-4-september-2026")],
      target: idOf("fri-4-september-2026"),
    }),
    expected: { outcome: "withheld", withheldReason: "stored_ticket_shared" },
  },
  {
    id: "S6",
    group: "Different events sharing a ticket page",
    setup: "Culture Box's Friday Tickets button wrongly points at Saturday's RA page (copy-paste error on the venue site); stored Friday has its own RA page.",
    truth: "withhold",
    build: () => {
      const fri = candidate("fri-11-september-2026");
      const satTicket = candidate("sat-12-september-2026").ticketUrl;
      return {
        rows: [storedFor("fri-11-september-2026"), storedFor("sat-12-september-2026")],
        links: [{ event_id: idOf("fri-11-september-2026"), source_url: page("fri-11-september-2026") }],
        candidates: [{ ...fri, ticketUrl: satTicket }],
        target: idOf("fri-11-september-2026"),
      };
    },
    expected: { outcome: "withheld", withheldReason: "shared_ticket_page" },
  },
  {
    id: "S7",
    group: "Same venue and date, different rooms",
    setup: "Stored per-room events for the night (.../#black-box and .../#red-box, each with its own ticket link, as Culture Box listed rooms before consolidation); Culture Box now lists the whole night as one event.",
    truth: "withhold",
    build: () => {
      const slug = "sat-19-september-2026";
      const c = candidate(slug);
      const base = storedFor(slug);
      const artists = base.artists as string[];
      const half = Math.ceil(artists.length / 2);
      return {
        rows: [
          { ...base, id: "e-black", title: c.title.split("·")[0].trim(), artists: artists.slice(0, half), official_event_url: `${page(slug)}#black-box`, ticket_url: "https://tickets.example/black" },
          { ...base, id: "e-red", title: (c.title.split("·")[1] ?? "Red Box").trim(), artists: artists.slice(half), official_event_url: `${page(slug)}#red-box`, ticket_url: "https://tickets.example/red" },
        ],
        links: [
          { event_id: "e-black", source_url: `${page(slug)}#black-box` },
          { event_id: "e-red", source_url: `${page(slug)}#red-box` },
        ],
        candidates: [c],
        target: "*",
      };
    },
    expected: { outcome: "withheld", withheldReason: "room_scope_mismatch" },
  },
  {
    id: "S8",
    group: "Same venue and date, different rooms",
    setup: "A Red Box listing (.../#red-box) whose source link was recorded against the stored Black Box event (.../#black-box) by a past data error.",
    truth: "withhold",
    build: () => {
      const slug = "fri-25-september-2026";
      return {
        rows: [storedFor(slug, { official_event_url: `${page(slug)}#black-box` })],
        links: [{ event_id: idOf(slug), source_url: `${page(slug)}#red-box` }],
        candidates: [{ ...candidate(slug), officialEventUrl: `${page(slug)}#red-box`, ticketUrl: NEW_TICKSTER }],
        target: idOf(slug),
      };
    },
    expected: { outcome: "withheld", withheldReason: "room_conflict" },
  },
  {
    id: "S9",
    group: "Moved event",
    setup: "Linked event stored a week earlier than Culture Box now lists it, with an older ticket link.",
    truth: "withhold",
    build: () => ({
      rows: [storedFor("fri-18-september-2026", { start_datetime: shift(candidate("fri-18-september-2026").startDatetime!, -7 * DAY), ticket_url: OLD_TICKSTER })],
      links: [{ event_id: idOf("fri-18-september-2026"), source_url: page("fri-18-september-2026") }],
      candidates: [candidate("fri-18-september-2026")],
      target: idOf("fri-18-september-2026"),
    }),
    expected: { outcome: "withheld", withheldReason: "moved_event" },
  },
  {
    id: "S10",
    group: "Several shows the same evening",
    setup: "The night page was first linked to an early live show (18:00) the same evening; the club night (22:00) brings its own ticket link.",
    truth: "withhold",
    build: () => {
      const c = candidate("sat-26-september-2026");
      return {
        rows: [storedFor("sat-26-september-2026", { id: "e-early", title: "Early live concert", artists: ["Some Live Band"], start_datetime: shift(c.startDatetime!, -4 * 3_600_000), ticket_url: "https://tickets.example/early-show" })],
        links: [{ event_id: "e-early", source_url: page("sat-26-september-2026") }],
        candidates: [c],
        target: "e-early",
      };
    },
    expected: { outcome: "withheld", withheldReason: "multiple_shows_same_evening" },
  },
  {
    id: "S11",
    group: "Wrong or ambiguous match",
    setup: "The night exists twice in storage (Culture Box's own and an aggregator duplicate, different ticket links); the candidate is linked to Culture Box's own copy.",
    truth: "replace",
    build: () => ({
      rows: [storedFor("sat-3-october-2026", { ticket_url: OLD_TICKSTER }), storedFor("sat-3-october-2026", { id: "e-dup", official_event_url: null, ticket_url: "https://tickets.example/dup", canonical_source_id: "src-hvaderpaa" })],
      links: [{ event_id: idOf("sat-3-october-2026"), source_url: page("sat-3-october-2026") }],
      candidates: [candidate("sat-3-october-2026")],
      target: idOf("sat-3-october-2026"),
    }),
    expected: { outcome: "withheld", withheldReason: "ambiguous_match" },
  },
  {
    id: "S12",
    group: "Wrong or ambiguous match",
    setup: "A different event the same evening (a daytime market, no lineup) copied the night's RA page as its ticket link; Culture Box switched vendor, so its ticket link is new while its RA page is unchanged.",
    truth: "withhold",
    build: () => {
      const c = candidate("fri-2-october-2026");
      return {
        rows: [{ ...storedFor("fri-2-october-2026"), id: "e-market", title: "Vintage flea market", artists: [], start_datetime: shift(c.startDatetime!, -1 * 3_600_000), official_event_url: null, resident_advisor_url: null, ticket_url: c.residentAdvisorUrl }],
        links: [],
        candidates: [{ ...c, ticketUrl: NEW_TICKSTER }],
        target: "e-market",
      };
    },
    expected: { outcome: "withheld", withheldReason: "ticket_url_only_identity" },
  },
  {
    id: "S13",
    group: "Manual change or clearing",
    setup: "An admin set the ticket link by hand (ticketUrl in overriddenFields).",
    truth: "withhold",
    build: () => ({ rows: [storedFor("fri-23-october-2026", { ticket_url: "https://tickets.example/admin-chosen", overridden_fields: ["ticketUrl"] })], links: [{ event_id: idOf("fri-23-october-2026"), source_url: page("fri-23-october-2026") }], candidates: [candidate("fri-23-october-2026")], target: idOf("fri-23-october-2026") }),
    expected: { outcome: "withheld", withheldReason: "override" },
  },
  {
    id: "S14",
    group: "Manual change or clearing",
    setup: "An admin deliberately cleared the ticket link (empty, ticketUrl in overriddenFields).",
    truth: "withhold",
    build: () => ({ rows: [storedFor("fri-23-october-2026", { ticket_url: null, overridden_fields: ["ticketUrl"] })], links: [{ event_id: idOf("fri-23-october-2026"), source_url: page("fri-23-october-2026") }], candidates: [candidate("fri-23-october-2026")], target: idOf("fri-23-october-2026") }),
    expected: { outcome: "withheld", withheldReason: "override" },
  },
  {
    id: "S15",
    group: "RA event URL that is also the ticket link",
    setup: "Linked event whose stored ticket link is its RA page; Culture Box switched to Tickster (RA page unchanged).",
    truth: "replace",
    build: () => ({ rows: [storedFor("fri-21-august-2026")], links: [{ event_id: idOf("fri-21-august-2026"), source_url: page("fri-21-august-2026") }], candidates: [{ ...candidate("fri-21-august-2026"), ticketUrl: NEW_TICKSTER }], target: idOf("fri-21-august-2026") }),
    expected: { outcome: "would_replace" },
  },
  {
    id: "S16",
    group: "RA event URL that is also the ticket link",
    setup: "Same night stored by an aggregator as a stub (generic title, no lineup, RA page as both RA and ticket link, no Culture Box link); Culture Box switched to Tickster.",
    truth: "replace",
    build: () => {
      const c = candidate("sat-12-september-2026");
      return {
        rows: [{ ...storedFor("sat-12-september-2026"), title: "Saturday club night", artists: [], official_event_url: null, canonical_source_id: "src-hvaderpaa" }],
        links: [],
        candidates: [{ ...c, ticketUrl: NEW_TICKSTER }],
        target: idOf("sat-12-september-2026"),
      };
    },
    expected: { outcome: "withheld", withheldReason: "ticket_url_only_identity" },
  },
];

interface SimResult {
  id: string;
  group: string;
  setup: string;
  truth: "replace" | "withhold";
  outcome: string;
  withheldReason: string | null;
  verdict: "TP" | "TN" | "FP" | "FN";
  identity: string | null;
  explanation: string[];
}

const results: SimResult[] = [];

describe("ticket-replacement shadow — SYNTHETIC scenarios on real Culture Box fixtures", () => {
  it("baseline: unchanged fixture data gives confirm for every night (mirrors the 2026-10-23 Production run)", async () => {
    const rows = NIGHTS.map((s) => storedFor(s));
    const links = NIGHTS.map((s) => ({ event_id: idOf(s), source_url: page(s) }));
    const report = await run(rows, links, realCandidates);
    expect(report.summary.total).toBe(15);
    expect(report.summary.byOutcome.confirm).toBe(15);
  });

  for (const s of SCENARIOS) {
    it(`${s.id} ${s.group}: ${s.setup}`, async () => {
      const { rows, links, candidates, target } = s.build();
      const report = await run(rows, links, candidates);
      const d = target === "*" ? report.decisions[0] : report.decisions.find((x) => x.eventId === target);
      const outcome = d?.outcome ?? "not_assessed";
      const verdict: SimResult["verdict"] =
        s.truth === "replace" ? (outcome === "would_replace" ? "TP" : "FN") : outcome === "would_replace" ? "FP" : "TN";
      results.push({
        id: s.id,
        group: s.group,
        setup: s.setup,
        truth: s.truth,
        outcome,
        withheldReason: d?.withheldReason ?? null,
        verdict,
        identity: d?.identity ? `${d.identity.level}; ${Object.entries(d.identity.checks).map(([k, v]) => `${k}=${v}`).join(", ")}; anchors=[${d.identity.anchors.join(", ")}]; discarded=[${d.identity.discardedTicketAnchors.join(", ")}]` : null,
        explanation: d?.explanation ?? [`no sync match: ${report.meta.candidatesWithoutSyncMatch} candidate(s) unmatched, so no decision`],
      });
      expect(outcome).toBe(s.expected.outcome);
      if (s.expected.withheldReason) expect(d?.withheldReason).toBe(s.expected.withheldReason);
    });
  }

  it("no false positives; the false negatives are the known conservative cases", () => {
    expect(results.filter((r) => r.verdict === "FP")).toEqual([]);
    expect(results.filter((r) => r.verdict === "FN").map((r) => r.id)).toEqual(["S4", "S5", "S11", "S16"]);
    if (process.env.SHADOW_SIM_OUT) writeFileSync(process.env.SHADOW_SIM_OUT, JSON.stringify(results, null, 2));
  });
});
