import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUARD_STATEMENTS, READ_ACCESS_SQL, REPORT_TABLES, ROLE_SQL } from "./reportReadOnlyGuard";
import {
  buildManualChoicesSection,
  buildNameSection,
  buildRuleReplaySection,
  CACHE_SQL,
  DISCOVERY_NAMES_SQL,
  EVENT_NAMES_SQL,
  EVENTS_SQL,
  MIGRATIONS_SQL,
  MIGRATIONS_TABLE_SQL,
  OVERRIDES_SQL,
  OVERRIDES_TABLE_SQL,
  READ_ONLY_TX_STATEMENTS,
  runYoutubePreviewRiskReport,
  type CacheRow,
  type QueryClient,
} from "./youtubePreviewRiskReport";

function evidenceFor(name: string, videoId: string, title: string, channelTitle: string, channelMatch: "own" | "trusted") {
  const candidate = { videoId, title, channelId: "c", channelTitle, channelMatch, publishedAt: "2025-01-01T00:00:00Z" };
  return {
    rawArtistName: name,
    cleanedName: name,
    primaryAttempt: {
      query: `${name} dj set`,
      candidatesReturned: 1,
      structurallyEligible: [candidate],
      rejected: [],
      verified: [{ videoId, durationSeconds: 3600, embeddable: true, privacyStatus: "public" }],
      selected: candidate,
      rejectedAfterVerification: [],
    },
    fallbackAttempt: null,
  };
}

function accepted(name: string, videoId: string, title: string, channelTitle: string, channelMatch: "own" | "trusted", manualBlock = false): CacheRow {
  return {
    artist_name_normalized: name.toLowerCase(),
    status: "accepted",
    video_id: videoId,
    video_title: title,
    channel_title: channelTitle,
    manual_block: manualBlock,
    evidence: evidenceFor(name, videoId, title, channelTitle, channelMatch),
  };
}

const CACHE: CacheRow[] = [
  accepted("DASHA", "WRFXZHZpvfU", "Dasha Rush Boiler Room x Present Perfect Festival DJ Set", "Boiler Room", "trusted"),
  accepted("Intercell", "Ozv-gv4Tywc", "Benwal b2b Sam Alfred at Intercell x Glitch Festival 2026 | Full set", "Intercell", "own"),
  accepted("Cassie Raptor", "ut_06vMLkaI", "Cassie Raptor | Boiler Room: Paris", "Boiler Room", "trusted"),
  accepted("Benji", "benjib", "Benji B | Boiler Room London", "Boiler Room", "trusted", true),
  { artist_name_normalized: "pippa", status: "abstain", video_id: null, video_title: null, channel_title: null, manual_block: false, evidence: {} },
];

describe("buildRuleReplaySection — manual choices", () => {
  it("a manual artist pin is reported as manual_pin, never judged by a rule", () => {
    const pin: CacheRow = {
      artist_name_normalized: "steamboi",
      status: "accepted",
      match_rule: "manual",
      video_id: "Pbb0KmuwYSA",
      video_title: "steamboi | REX Radio (10.11.25)",
      channel_title: "REX Radio",
      manual_block: false,
      evidence: {},
    };
    const section = buildRuleReplaySection([pin]);
    expect(section.outcomeCounts).toMatchObject({ manual_pin: 1, not_replayable: 0, would_abstain: 0, other_candidate_available: 0 });
    expect(section.affectedByProposedRules).toEqual([]);
  });
});

describe("buildRuleReplaySection", () => {
  const section = buildRuleReplaySection(CACHE);

  it("counts every cache row by status and block", () => {
    expect(section).toMatchObject({ cacheRows: 5, acceptedRows: 4, abstainRows: 1, manuallyBlockedRows: 1 });
  });

  it("lists every accepted match a proposed rule touches, and leaves the rest out", () => {
    expect(section.affectedByProposedRules.map((r) => r.artist).sort()).toEqual(["dasha", "intercell"]);
  });

  it("lists matches today's production rules would no longer accept, keeping the manual block visible", () => {
    expect(section.failingCurrentRules.map((r) => [r.artist, r.manualBlock])).toEqual([["benji", true]]);
  });

  it("tallies every accepted row exactly once across outcomes", () => {
    const total = Object.values(section.outcomeCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(section.acceptedRows);
    expect(section.outcomeCounts.unchanged).toBe(1);
  });
});

describe("buildNameSection", () => {
  const section = buildNameSection(
    [
      { name: "Karrusel 2027", events_total: 1, events_visible: 1 },
      { name: "Byetone DE", events_total: 2, events_visible: 0 },
      { name: "Above & Beyond", events_total: 1, events_visible: 1 },
      { name: "Neelix & friends", events_total: 1, events_visible: 1 },
    ],
    [
      { name: "Karrusel 2027", discovery_total: 2, discovery_pending: 1 },
      { name: "DJs", discovery_total: 1, discovery_pending: 1 },
    ],
    [accepted("Neelix & friends", "v", "Neelix & friends live", "Neelix & friends", "own")],
  );

  it("merges counts for a name seen in both events and discovery", () => {
    expect(section.notArtist.find((n) => n.name === "Karrusel 2027")).toMatchObject({ eventsTotal: 1, eventsVisible: 1, discoveryTotal: 2, discoveryPending: 1 });
  });

  it("keeps not-artist and cleanable names apart, and counts ok names without listing them", () => {
    expect(section.distinctNames).toBe(5);
    expect(section.verdictCounts).toEqual({ ok: 1, not_artist: 3, cleanable: 1 });
    expect(section.cleanable.map((n) => n.name)).toEqual(["Byetone DE"]);
    expect(section.notArtist.map((n) => n.name)).not.toContain("Above & Beyond");
  });

  it("surfaces a flagged name that holds an accepted match as a potential false positive", () => {
    expect(section.flaggedWithAcceptedMatch.map((n) => n.name)).toEqual(["Neelix & friends"]);
  });
});

class FakeClient implements QueryClient {
  statements: string[] = [];
  constructor(
    private readonly readOnly: string = "on",
    private readonly failOn: string | null = null,
    private readonly overrideTable: string | null = null,
    private readonly migrationsTable: string | null = "drizzle.__drizzle_migrations",
    private readonly roleWritable = false,
  ) {}
  async query(sql: string): Promise<{ rows: unknown[] }> {
    this.statements.push(sql);
    if (this.failOn && sql === this.failOn) throw new Error("boom");
    if (sql === READ_ONLY_TX_STATEMENTS.verify) return { rows: [{ transaction_read_only: this.readOnly }] };
    if (sql === ROLE_SQL) {
      const clean = { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false, member_of: [], db_create: false, db_temp: false, db_owner: false, default_read_only: "on" };
      return { rows: [{ ...clean, rolname: "report_ro", rolcreaterole: this.roleWritable }] };
    }
    if (sql === READ_ACCESS_SQL) return { rows: REPORT_TABLES.map((t) => ({ schema: t.schema, name: t.name, can_select: true, rls: false, open_policy: false, restrictive_policy: false })) };
    if ((GUARD_STATEMENTS as readonly string[]).includes(sql)) return { rows: [] };
    if (sql === CACHE_SQL) return { rows: CACHE };
    if (sql === MIGRATIONS_TABLE_SQL) return { rows: [{ t: this.migrationsTable }] };
    if (sql === MIGRATIONS_SQL) return { rows: [{ created_at: "1792778571190" }] };
    if (sql === OVERRIDES_TABLE_SQL) return { rows: [{ t: this.overrideTable }] };
    if (sql === OVERRIDES_SQL) return { rows: [{ event_id: "e1", mode: "hidden", video_id: null, available: true }] };
    return { rows: [] };
  }
}

describe("runYoutubePreviewRiskReport — read-only discipline", () => {
  it("runs BEGIN READ ONLY → timeout → verify → SELECTs → ROLLBACK, and nothing else", async () => {
    const client = new FakeClient();
    await runYoutubePreviewRiskReport(client, new Date("2026-10-16T00:00:00Z"));
    expect(client.statements).toEqual([
      READ_ONLY_TX_STATEMENTS.begin,
      READ_ONLY_TX_STATEMENTS.timeout,
      READ_ONLY_TX_STATEMENTS.verify,
      ...GUARD_STATEMENTS,
      CACHE_SQL,
      EVENT_NAMES_SQL,
      DISCOVERY_NAMES_SQL,
      EVENTS_SQL,
      MIGRATIONS_TABLE_SQL,
      MIGRATIONS_SQL,
      OVERRIDES_TABLE_SQL,
      READ_ONLY_TX_STATEMENTS.rollback,
    ]);
  });

  it("does not read the migrations table when it does not exist", async () => {
    const client = new FakeClient("on", null, null, null);
    const report = await runYoutubePreviewRiskReport(client, new Date(), [{ tag: "0023_event_youtube_preview_overrides", when: 1792778571190 }]);
    expect(client.statements).not.toContain(MIGRATIONS_SQL);
    expect(report.manualChoices.migrations).toMatchObject({ trackingTablePresent: false, pendingInRepo: ["0023_event_youtube_preview_overrides"] });
  });

  it("refuses to query anything when the transaction is not read-only, and still rolls back", async () => {
    const client = new FakeClient("off");
    await expect(runYoutubePreviewRiskReport(client)).rejects.toThrow(/expected "on"/);
    expect(client.statements).not.toContain(CACHE_SQL);
    expect(client.statements.at(-1)).toBe(READ_ONLY_TX_STATEMENTS.rollback);
  });

  it("refuses to read any data when the login role can write, and still rolls back", async () => {
    const client = new FakeClient("on", null, null, "drizzle.__drizzle_migrations", true);
    await expect(runYoutubePreviewRiskReport(client)).rejects.toThrow(/not proven read-only[\s\S]*CREATEROLE/);
    expect(client.statements).not.toContain(CACHE_SQL);
    expect(client.statements.at(-1)).toBe(READ_ONLY_TX_STATEMENTS.rollback);
  });

  it("checks the role only after the READ ONLY transaction is verified", async () => {
    const client = new FakeClient("off");
    await expect(runYoutubePreviewRiskReport(client)).rejects.toThrow(/expected "on"/);
    expect(client.statements).not.toContain(ROLE_SQL);
  });

  it("rolls back when a query fails", async () => {
    const client = new FakeClient("on", EVENT_NAMES_SQL);
    await expect(runYoutubePreviewRiskReport(client)).rejects.toThrow("boom");
    expect(client.statements.at(-1)).toBe(READ_ONLY_TX_STATEMENTS.rollback);
  });

  it("reports a missing override table without querying it", async () => {
    const client = new FakeClient();
    const report = await runYoutubePreviewRiskReport(client);
    expect(client.statements).not.toContain(OVERRIDES_SQL);
    expect(report.events).toMatchObject({ eventOverrides: "table_not_present" });
  });

  it("reads the override table only after to_regclass finds it", async () => {
    const client = new FakeClient("on", null, "event_youtube_preview_overrides");
    const report = await runYoutubePreviewRiskReport(client);
    expect(client.statements.slice(-3)).toEqual([OVERRIDES_TABLE_SQL, OVERRIDES_SQL, READ_ONLY_TX_STATEMENTS.rollback]);
    expect(report.events).toMatchObject({ eventOverrides: { rows: 1 } });
  });

  it("fails closed: an unreadable override table skips the event section, keeps the rest, and rolls back", async () => {
    const client = new FakeClient("on", OVERRIDES_SQL, "event_youtube_preview_overrides");
    const report = await runYoutubePreviewRiskReport(client);
    expect(report.events).toMatchObject({ skipped: true });
    expect(report.rules.acceptedRows).toBe(4);
    expect(client.statements.at(-1)).toBe(READ_ONLY_TX_STATEMENTS.rollback);
  });

  it("every data query is a plain SELECT", () => {
    for (const sql of [CACHE_SQL, EVENT_NAMES_SQL, DISCOVERY_NAMES_SQL, EVENTS_SQL, MIGRATIONS_TABLE_SQL, MIGRATIONS_SQL, OVERRIDES_TABLE_SQL, OVERRIDES_SQL]) {
      expect(sql.trimStart().startsWith("SELECT ")).toBe(true);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT)\b/i);
    }
  });
});

describe("buildManualChoicesSection — reports the manual choices as they are", () => {
  const JOURNAL = [
    { tag: "0022_soundcloud_artist_links", when: 1792000000000 },
    { tag: "0023_event_youtube_preview_overrides", when: 1792778571190 },
  ];
  const pin: CacheRow = { ...accepted("steamboi", "Pbb0KmuwYSA", "steamboi | REX Radio (10.11.25)", "REX Radio", "trusted"), match_rule: "manual", expires_at: "2100-01-01T00:00:00Z" };
  const lmn: CacheRow = { ...accepted("lmn", "lmnvid", "LMN live", "LMN", "own", true), match_rule: "A" };
  const steamOverride = { event_id: "e-a2b5cf47", slug: "steamboi-night", mode: "video", video_id: "Pbb0KmuwYSA", available: true };

  it("before the move: 0023 missing, pin still in place, LMN blocked", () => {
    const s = buildManualChoicesSection([pin, lmn], 1792000000000, JOURNAL, "table_not_present");
    expect(s.migrations.pendingInRepo).toEqual(["0023_event_youtube_preview_overrides"]);
    expect(s.ownerChecks.map((c) => c.status)).toEqual(["not_done", "not_done", "not_done", "confirmed"]);
    expect(s.artistPins).toEqual([{ artist: "steamboi", videoId: "Pbb0KmuwYSA", videoTitle: "steamboi | REX Radio (10.11.25)", expiresAt: "2100-01-01T00:00:00.000Z", manualBlock: false }]);
    expect(s.artistBlocks.map((b) => b.artist)).toEqual(["lmn"]);
  });

  it("0023 applied but nothing moved yet: the override is reported missing, the pin still in place", () => {
    const s = buildManualChoicesSection([pin, lmn], 1792778571190, JOURNAL, []);
    expect(s.ownerChecks.map((c) => c.status)).toEqual(["confirmed", "not_done", "not_done", "confirmed"]);
  });

  it("after the move: event override shown, pin released, LMN still blocked", () => {
    const released = { ...pin, match_rule: "A" };
    const s = buildManualChoicesSection([released, lmn], 1792778571190, JOURNAL, [steamOverride]);
    expect(s.ownerChecks.map((c) => c.status)).toEqual(["confirmed", "confirmed", "confirmed", "confirmed"]);
    expect(s.eventOverrides[0]).toMatchObject({ eventId: "e-a2b5cf47", slug: "steamboi-night", decision: "video" });
  });

  it("an unavailable override is reported as not shown, and an unreadable table as unknown", () => {
    expect(buildManualChoicesSection([pin, lmn], 1792778571190, JOURNAL, [{ ...steamOverride, available: false }]).ownerChecks[1].status).toBe("not_done");
    expect(buildManualChoicesSection([pin, lmn], 1792778571190, JOURNAL, "unreadable").ownerChecks.slice(0, 2).map((c) => c.status)).toEqual(["unknown", "unknown"]);
  });

  it("LMN no longer blocked is reported as not_done", () => {
    expect(buildManualChoicesSection([pin, { ...lmn, manual_block: false }], 1792778571190, JOURNAL, []).ownerChecks[3].status).toBe("not_done");
  });
});

describe("youtube-preview-risk-report-readonly.yml", () => {
  // Comment lines are documentation (they name the key the workflow does NOT
  // use, and the library files behind the CLI) — only the executable YAML
  // is checked.
  const yaml = readFileSync(path.join(process.cwd(), ".github/workflows/youtube-preview-risk-report-readonly.yml"), "utf-8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  it("only runs on manual dispatch, or once on the exact label on PR #141 from this repository", () => {
    expect(yaml).toMatch(/^on:\n {2}workflow_dispatch:\n {2}pull_request:\n {4}types: \[labeled\]\n\n/m);
    expect(yaml).not.toMatch(/^\s*(schedule|push|pull_request_target|workflow_run):/m);
    expect(yaml).toContain("github.event_name == 'workflow_dispatch' ||");
    expect(yaml).toContain("github.event.label.name == 'run-youtube-risk-report' &&");
    expect(yaml).toContain("github.event.pull_request.number == 141 &&");
    expect(yaml).toContain("github.event.pull_request.head.repo.full_name == github.repository)");
  });

  it("passes only DATABASE_URL_REPORT_RO, and only to the secret check and the report step — never DATABASE_URL", () => {
    expect([...yaml.matchAll(/secrets\.(\w+)/g)].map((m) => m[1])).toEqual(["DATABASE_URL_REPORT_RO", "DATABASE_URL_REPORT_RO"]);
    expect(yaml).not.toMatch(/\bDATABASE_URL\b(?!_REPORT_RO)/);
  });

  it("stops before installing anything when the secret is missing", () => {
    expect(yaml.indexOf("Verify DATABASE_URL_REPORT_RO secret is configured")).toBeLessThan(yaml.indexOf("npm ci"));
    expect(yaml).toMatch(/if \[ -z "\$\{DATABASE_URL_REPORT_RO:-\}" \]; then[\s\S]*?exit 1/);
  });

  it("never receives the YouTube API key", () => {
    expect(yaml).not.toMatch(/YOUTUBE_API_KEY/);
  });

  it("has read-only repository permissions", () => {
    expect(yaml).toMatch(/^permissions:\n {2}contents: read\n/m);
  });

  it("runs the read-only report CLI and nothing else from src/db", () => {
    const scripts = [...yaml.matchAll(/src\/db\/\w+\.ts/g)].map((m) => m[0]);
    expect(new Set(scripts)).toEqual(new Set(["src/db/youtubePreviewRiskReportCli.ts"]));
  });

  it("has no ${{ }} expression inside a run: script", () => {
    const runBlocks = yaml.split(/\n\s*- name: /).map((step) => step.split(/\n\s+run: /)[1] ?? "");
    for (const block of runBlocks) expect(block.split(/\n\s+(?:uses|with|env|if):/)[0]).not.toContain("${{");
  });
});
