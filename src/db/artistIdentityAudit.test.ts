import { describe, expect, it } from "vitest";
import {
  AUDIT_QUERIES,
  AUDIT_TABLE_NAMES,
  buildArtistIdentityAudit,
  isPublicUpcoming,
  isoWeekLabel,
  loadArtistIdentityAuditData,
  type AuditData,
  type AuditEventRow,
} from "./artistIdentityAudit";

const NOW = new Date("2026-10-24T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

let seq = 0;
function ev(overrides: Partial<AuditEventRow>): AuditEventRow {
  seq++;
  return {
    id: `e-${seq}`,
    title: `Night ${seq}`,
    artists: [],
    startDatetime: days(10),
    endDatetime: null,
    published: true,
    cancelled: false,
    postponed: false,
    adminUnpublishReason: null,
    sourceCancelledAt: null,
    venueId: "v-club",
    canonicalSourceId: "src-a",
    createdAt: days(-5),
    ...overrides,
  };
}

function data(overrides: Partial<AuditData>): AuditData {
  return {
    events: [],
    venues: [{ id: "v-club", name: "Club One", aliases: ["C1"], rooms: [{ name: "Red Room" }] }],
    sources: [
      { id: "src-a", sourceName: "Source A" },
      { id: "src-b", sourceName: "Source B" },
    ],
    soundcloudLinks: [],
    blockedSoundcloudUrls: [],
    genreCache: [],
    changeLog: [],
    pendingDiscoveryLineups: [],
    ...overrides,
  };
}

describe("isPublicUpcoming", () => {
  it("only counts published, not cancelled, not unpublished, not yet ended events", () => {
    expect(isPublicUpcoming(ev({}), NOW)).toBe(true);
    expect(isPublicUpcoming(ev({ published: false }), NOW)).toBe(false);
    expect(isPublicUpcoming(ev({ cancelled: true }), NOW)).toBe(false);
    expect(isPublicUpcoming(ev({ adminUnpublishReason: "duplicate" }), NOW)).toBe(false);
    expect(isPublicUpcoming(ev({ sourceCancelledAt: days(-1) }), NOW)).toBe(false);
    expect(isPublicUpcoming(ev({ startDatetime: days(-2) }), NOW)).toBe(false);
    // started yesterday evening with no end: still listed until start + 1 day
    expect(isPublicUpcoming(ev({ startDatetime: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) }), NOW)).toBe(true);
  });
});

describe("buildArtistIdentityAudit", () => {
  it("reports coverage per source and what can support alerts", () => {
    const report = buildArtistIdentityAudit(
      data({
        events: [
          ev({ artists: ["Kasper Bjørke", "Sexy Lazer"], canonicalSourceId: "src-a" }),
          ev({ artists: [], canonicalSourceId: "src-b" }),
          ev({ artists: ["TBA"], canonicalSourceId: "src-b" }),
          ev({ artists: ["Kasper Bjørke"], cancelled: true }),
        ],
      }),
      NOW,
    );
    expect(report.coverage.upcomingPublicEvents).toBe(3);
    expect(report.coverage.bySource["Source A"]).toMatchObject({ events: 1, withLineup: 1, withHighAppearance: 1, high: 2 });
    expect(report.coverage.bySource["Source B"]).toMatchObject({ events: 2, withLineup: 1, withHighAppearance: 0, excluded: 1 });
    expect(report.alertSupport).toMatchObject({ eventsWithAHighAppearance: 1, highAppearances: 2, distinctHighArtists: 2 });
    expect(report.insufficientLineup.byReason).toEqual({ no_lineup: 1, only_non_artists: 1 });
  });

  it("separates event titles stored as artists from real headliners", () => {
    const report = buildArtistIdentityAudit(
      data({
        events: [
          ev({ title: "Protoned Christmas Rave", artists: ["Protoned Christmas Rave"] }),
          ev({ title: "ERIC PRYDZ", artists: ["ERIC PRYDZ"] }),
          ev({ title: "Holo", artists: ["Eric Prydz", "Someone Else"], startDatetime: days(-100), endDatetime: days(-100) }),
        ],
      }),
      NOW,
    );
    expect(report.titleAsArtist.total).toBe(2);
    expect(report.titleAsArtist.withEventWord).toBe(1);
    expect(report.titleAsArtist.seenAsPerformerElsewhere).toBe(1);
    expect(report.insufficientLineup.byReason).toEqual({ only_review_names: 1, only_title_as_artist: 1 });
    expect(report.alertSupport.eventsAlsoWithPendingDecision).toBe(1);
  });

  it("uses the source's own SoundCloud links, ignores blocked ones and flags conflicting profiles", () => {
    const a = ev({ artists: ["NAT", "Guy Two"] });
    const b = ev({ artists: ["NAT"], canonicalSourceId: "src-b" });
    const c = ev({ artists: ["Guy Two"], canonicalSourceId: "src-b" });
    const report = buildArtistIdentityAudit(
      data({
        events: [a, b, c],
        soundcloudLinks: [
          { eventId: a.id, artistName: "NAT", url: "https://soundcloud.com/nat-one" },
          { eventId: a.id, artistName: "Guy Two", url: "https://soundcloud.com/guytwo" },
          { eventId: c.id, artistName: "Guy Two", url: "https://soundcloud.com/another-guy" },
          { eventId: b.id, artistName: "NAT", url: "https://soundcloud.com/blocked" },
        ],
        blockedSoundcloudUrls: ["https://soundcloud.com/blocked"],
      }),
      NOW,
    );
    expect(report.appearanceBuckets.byBucket).toMatchObject({ handle: 3, short_generic: 1 });
    expect(report.collisions.handleConflicts.examples).toEqual([{ key: "guy two", handles: ["https://soundcloud.com/guytwo", "https://soundcloud.com/another-guy"] }]);
    expect(report.reviewWorkload.shortNameSourcePairs).toBe(1);
    expect(report.reviewWorkload.shortNameSourcePairsWithAHandleElsewhere).toBe(1);
  });

  it("counts names whose bracketed label would make today's key miss a match", () => {
    const report = buildArtistIdentityAudit(
      data({ events: [ev({ artists: ["Damian Lazarus [Crosstown Rebels]"] }), ev({ artists: ["Damian Lazarus", "X Person"] })] }),
      NOW,
    );
    expect(report.keyNormalisation.total).toBe(1);
    expect(report.keyNormalisation.wouldOtherwiseMissAMatch).toBe(1);
    expect(report.collisions.spellingVariants.total).toBe(0); // brackets are expected decoration, not a variant
  });

  it("lists names that differ only by accents without merging them", () => {
    const report = buildArtistIdentityAudit(data({ events: [ev({ artists: ["Âme", "Other One"] }), ev({ artists: ["Ame", "Other Two"] })] }), NOW);
    expect(report.collisions.diacriticVariants.examples).toEqual([["Âme", "Ame"]]);
  });

  it("reports B2B entries and possible multi-act entries without splitting the latter", () => {
    const report = buildArtistIdentityAudit(
      data({
        events: [
          ev({ artists: ["Aja Gulris b2b Nayz", "Opener Person"] }),
          ev({ artists: ["Kevin de Vries & Massano"] }),
          ev({ artists: ["Kevin de Vries", "Massano", "Other Name"], startDatetime: days(-30), endDatetime: days(-30) }),
          ev({ artists: ["Chase & Status", "Third Person"] }),
        ],
      }),
      NOW,
    );
    expect(report.splits.b2bEntries.examples).toEqual(["Aja Gulris b2b Nayz"]);
    expect(report.appearanceBuckets.byBucket.distinct).toBeGreaterThanOrEqual(3); // Aja Gulris, Opener Person, Third Person
    const weak = report.splits.possibleMultiActEntries;
    expect(weak.total).toBe(2);
    expect(weak.allPartsKnown).toBe(1);
    expect(weak.examples.find((w) => w.name === "Chase & Status")?.partsKnownAsSoloArtists).toBe(0);
  });

  it("excludes venue names, aliases and rooms", () => {
    const report = buildArtistIdentityAudit(data({ events: [ev({ artists: ["Club One", "C1", "Red Room", "Real Artist"] })] }), NOW);
    expect(report.appearanceBuckets.byBucket.venue_name).toBe(3);
  });

  it("surfaces Discogs ambiguity for upcoming lineup names", () => {
    const report = buildArtistIdentityAudit(
      data({
        events: [ev({ artists: ["Ambiguous Name", "Sure Name"] })],
        genreCache: [
          { key: "ambiguous name", lookupStatus: "ambiguous", identityConfidence: null },
          { key: "sure name", lookupStatus: "found", identityConfidence: "medium" },
        ],
      }),
      NOW,
    );
    expect(report.collisions.discogsAmbiguousOrLowIdentity.examples).toEqual([{ name: "Ambiguous Name", lookupStatus: "ambiguous", identityConfidence: null }]);
    expect(report.collisions.sameNameDifferentArtists.basis).toBe("undeterminable");
  });

  it("buckets weekly volume and lineup changes, keeping admin and source changes apart", () => {
    const e1 = ev({ artists: ["New Act One", "New Act Two"], createdAt: days(-3) });
    const e2 = ev({ artists: ["ENNA"], createdAt: days(-10) });
    const report = buildArtistIdentityAudit(
      data({
        events: [e1, e2],
        changeLog: [
          { eventId: e1.id, changedBy: "src-a", changeType: "create", fieldsChanged: ["artists"], createdAt: days(-3) },
          { eventId: e1.id, changedBy: "src-a", changeType: "sync", fieldsChanged: ["artists", "title"], createdAt: days(-2) },
          { eventId: e2.id, changedBy: "admin", changeType: "update", fieldsChanged: ["artists"], createdAt: days(-1) },
          { eventId: e2.id, changedBy: "src-a", changeType: "sync", fieldsChanged: ["artists"], createdAt: days(-200) },
        ],
      }),
      NOW,
    );
    expect(report.lineupChanges.rows).toBe(2);
    expect(report.lineupChanges.byChangedBy).toEqual({ "Source A": 1, admin: 1 });
    expect(report.lineupChanges.additionsVersusRemovals.basis).toBe("undeterminable");
    const weeks = Object.values(report.reviewWorkload.byWeek);
    expect(weeks.reduce((s, w) => s + w.newEvents, 0)).toBe(2);
    expect(weeks.reduce((s, w) => s + w.newHighAppearances, 0)).toBe(2);
    expect(weeks.reduce((s, w) => s + w.newReviewItems, 0)).toBe(1);
  });

  it("labels every section with how its figures were obtained", () => {
    const report = buildArtistIdentityAudit(data({}), NOW);
    expect(report.coverage.basis).toBe("observed");
    expect(report.reviewWorkload.basis).toBe("estimated");
    expect(report.alertSupport.basis).toBe("estimated");
    expect(report.collisions.shortNamesAtSeveralVenues.basis).toBe("estimated");
  });
});

describe("isoWeekLabel", () => {
  it("follows ISO-8601 week numbering", () => {
    expect(isoWeekLabel(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeekLabel(new Date("2026-10-24T00:00:00Z"))).toBe("2026-W43");
    expect(isoWeekLabel(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });
});

describe("audit queries", () => {
  it("are SELECT-only and touch only the tables the guard checks", () => {
    for (const sql of Object.values(AUDIT_QUERIES)) {
      const trimmed = sql.trim();
      expect(trimmed.startsWith("SELECT")).toBe(true);
      expect(trimmed.replace(/'[^']*'/g, "''")).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|COPY|FOR UPDATE|nextval)\b/i);
      const tables = [...trimmed.matchAll(/\bFROM\s+([a-z_]+)/gi)].map((m) => m[1]);
      for (const t of tables) expect(AUDIT_TABLE_NAMES as readonly string[]).toContain(t);
    }
  });

  it("never reads subscriber or newsletter tables", () => {
    expect(AUDIT_TABLE_NAMES.some((t) => /newsletter|subscriber|alert_/.test(t))).toBe(false);
  });

  it("maps database rows into report input", async () => {
    const responses: Record<string, Record<string, unknown>[]> = {
      [AUDIT_QUERIES.events]: [
        {
          id: "e1", title: "T", artists: ["A"], start_datetime: "2026-11-01T22:00:00Z", end_datetime: null, published: true,
          cancelled: false, postponed: false, admin_unpublish_reason: null, source_cancelled_at: null, venue_id: "v",
          canonical_source_id: "src-a", created_at: "2026-10-20T00:00:00Z",
        },
      ],
      [AUDIT_QUERIES.venues]: [{ id: "v", name: "V", aliases: null, rooms: [] }],
      [AUDIT_QUERIES.pendingDiscovery]: [{ detected_lineup: ["X", 3] }],
    };
    const seen: string[] = [];
    const client = { query: async (sql: string) => { seen.push(sql); return { rows: responses[sql] ?? [] }; } };
    const loaded = await loadArtistIdentityAuditData(client);
    expect(seen).toHaveLength(Object.keys(AUDIT_QUERIES).length);
    expect(loaded.events[0]).toMatchObject({ id: "e1", artists: ["A"], endDatetime: null, canonicalSourceId: "src-a" });
    expect(loaded.events[0].startDatetime.toISOString()).toBe("2026-11-01T22:00:00.000Z");
    expect(loaded.venues[0].aliases).toEqual([]);
    expect(loaded.pendingDiscoveryLineups).toEqual([["X"]]);
  });
});
