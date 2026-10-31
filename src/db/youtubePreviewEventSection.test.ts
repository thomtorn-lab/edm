import { describe, expect, it } from "vitest";
import { buildEventSection, shownPreviewArtist, type CacheRow, type EventRow } from "./youtubePreviewRiskReport";

interface Cand {
  videoId: string;
  title: string;
  channelTitle: string;
  channelMatch?: "own" | "trusted";
  publishedAt?: string;
}

/** A cache row with evidence in exactly the shape youtubePreviewMatching.ts stores. */
function accepted(key: string, cleanedName: string, current: Cand, others: Cand[] = [], manualBlock = false): CacheRow {
  const all = [current, ...others].map((c) => ({ channelId: `ch-${c.channelTitle}`, channelMatch: c.channelMatch ?? "own", publishedAt: c.publishedAt ?? "2025-01-01T00:00:00Z", ...c }));
  return {
    artist_name_normalized: key,
    status: "accepted",
    video_id: current.videoId,
    video_title: current.title,
    channel_title: current.channelTitle,
    manual_block: manualBlock,
    evidence: {
      cleanedName,
      primaryAttempt: {
        query: `${cleanedName} dj set`,
        structurallyEligible: all,
        rejected: [],
        verified: all.map((c) => ({ videoId: c.videoId, durationSeconds: 3600, embeddable: true, privacyStatus: "public" })),
        selected: all[0],
      },
      fallbackAttempt: null,
    },
  };
}

/** A real abstain: searched, nothing passed. */
function abstain(key: string): CacheRow {
  const attempt = { query: `${key} dj set`, candidatesReturned: 0, structurallyEligible: [], rejected: [], verified: [], selected: null, rejectedAfterVerification: [] };
  return { artist_name_normalized: key, status: "abstain", video_id: null, video_title: null, channel_title: null, manual_block: false, evidence: { rawArtistName: key, cleanedName: key, primaryAttempt: attempt, fallbackAttempt: null } };
}

function event(overrides: Partial<EventRow> & Pick<EventRow, "id" | "artists">): EventRow {
  return {
    slug: overrides.id,
    title: "Night",
    description: null,
    image_url: null,
    start_datetime: "2026-11-06T21:00:00.000Z",
    canonical_source_id: "src-culture-box",
    source_ids: ["src-culture-box"],
    ...overrides,
  };
}

const DASHA = accepted("dasha", "DASHA", { videoId: "WRFXZHZpvfU", title: "Dasha Rush Boiler Room x Present Perfect Festival DJ Set", channelTitle: "Boiler Room", channelMatch: "trusted" });
const ADELINA = accepted("adelina", "ADELINA", { videoId: "axkFsBI2E6U", title: "AFRO DJ AUDIO SET 2026 - ADELINA.", channelTitle: "Adelina" });
const LUKE = accepted("luke slater", "Luke Slater", { videoId: "5NuRC714fv8", title: "Chris Liebing B2B Luke Slater | Boiler Room: Warsaw", channelTitle: "Boiler Room", channelMatch: "trusted" });

const SARAH_WILD_NIGHT = event({
  id: "e-261106",
  title: "Black Box: SARAH WILD, PELZMAN, DJ SPICE · Red Box: DASHA, ANYA, FREDE [NO], JAN BRANDI",
  artists: ["SARAH WILD", "PELZMAN", "DJ SPICE", "DASHA", "ANYA", "FREDE [NO]", "JAN BRANDI"],
  description:
    "Sarah Wild is back. Expect uplifting grooves at Culture Box.\n\nBlack Box\nSARAH WILD, PELZMAN, DJ SPICE\n\nRed Box\nDASHA, ANYA, FREDE [NO], JAN BRANDI",
  image_url: "https://culture-box.com/wp-content/uploads/2026/09/261106_culture_box_sarah_wild_event-kopi-1.jpg",
});

const ANIMAL_TRAINER_NIGHT = event({
  id: "e-261114",
  title: "Black Box: ANIMAL TRAINER, MULO, KLARSKOV · Red Box: ADELINA, LEANCA, ANTOINE",
  artists: ["ANIMAL TRAINER", "MULO", "KLARSKOV", "ADELINA", "LEANCA", "ANTOINE"],
  description:
    "Switzerland's Animal Trainer jets in to headline Culture Box.\n\nBlack Box\nANIMAL TRAINER, MULO, KLARSKOV\n\nRed Box\nADELINA, LEANCA, ANTOINE",
});

const INTERCELL_NIGHT = event({
  id: "e-intercell",
  title: "Intercell",
  artists: ["Intercell", "Luke Slater", "Rene Wise"],
  canonical_source_id: "src-poolen",
  source_ids: ["src-poolen"],
});

describe("buildEventSection — the owner's known cases", () => {
  const section = buildEventSection([SARAH_WILD_NIGHT, ANIMAL_TRAINER_NIGHT, INTERCELL_NIGHT], [DASHA, ADELINA, LUKE, abstain("intercell")]);
  const byId = Object.fromEntries(section.events.map((e) => [e.id, e]));

  it("6 Nov shows DASHA today although Sarah Wild is the prioritized headliner, who has no match", () => {
    const e = byId["e-261106"];
    expect(e.headliner).toMatchObject({ confidence: "supported_prioritized", headliners: ["SARAH WILD"] });
    expect(e.shownToday).toMatchObject({ artist: "DASHA", isHeadliner: false, solo: true });
    expect(e.shownVideoFailsProposedRules).toBe(true);
    expect(e.headliners[0]).toMatchObject({ artist: "SARAH WILD", cacheStatus: "none", video: null });
    expect(e.outcome).toBe("headliner_no_match");
    // DASHA fails a proposed rule, so it is no strong fallback: nothing would be shown.
    expect(e.strongFallbacks).toEqual([]);
    expect(e.simulated).toEqual({ artist: null, videoId: null, reason: "none", changesFromToday: true, requiresVisibleArtistName: false });
  });

  it("14 Nov shows ADELINA today although Animal Trainer is the documented headliner", () => {
    const e = byId["e-261114"];
    expect(e.headliner).toMatchObject({ confidence: "documented", headliners: ["ANIMAL TRAINER"] });
    expect(e.shownToday).toMatchObject({ artist: "ADELINA", isHeadliner: false });
    expect(e.outcome).toBe("headliner_no_match");
  });

  it("Intercell: shows Luke Slater's B2B with Chris Liebing, who does not perform; the title copy is listed for review", () => {
    const e = byId["e-intercell"];
    expect(e.shownToday).toMatchObject({ artist: "Luke Slater", solo: false, partners: ["Chris Liebing"], outsiders: ["Chris Liebing"] });
    expect(e.strongFallbacks).toEqual([]);
    expect(section.titleCopyNeedsReview).toEqual(['e-intercell — "Intercell"']);
  });

  it("counts the need behind a safe_alternates column", () => {
    expect(section.safeAlternatesNeed).toEqual({ solvableOnlyFromEvidence: 0, b2bOutsiderNoAlternative: 0, headlinerWithoutMatch: 3 });
  });
});

describe("buildEventSection — simulated choice follows the owner's principles", () => {
  it("the headliner's own solo video is preferred over a support act listed first", () => {
    const night = event({ id: "e1", artists: ["Opener Act", "Big Name"], description: "Big Name headlines the night." });
    const s = buildEventSection(
      [night],
      [
        accepted("opener act", "Opener Act", { videoId: "op", title: "Opener Act - Live at Home", channelTitle: "Opener Act" }),
        accepted("big name", "Big Name", { videoId: "big", title: "Big Name | Boiler Room London", channelTitle: "Boiler Room", channelMatch: "trusted" }),
      ],
    );
    expect(s.events[0]).toMatchObject({
      outcome: "headliner_has_video_not_shown",
      shownToday: { artist: "Opener Act" },
      simulated: { artist: "Big Name", videoId: "big", reason: "headliner_solo", changesFromToday: true },
    });
  });

  it("a stored, verified solo video replaces a B2B with a non-performer — and is counted as evidence-only", () => {
    const night = event({ id: "e2", artists: ["Big Name", "Opener Act"], description: "Big Name headlines the night." });
    const s = buildEventSection(
      [night],
      [
        accepted(
          "big name",
          "Big Name",
          { videoId: "b2b", title: "Other Star B2B Big Name | Boiler Room", channelTitle: "Boiler Room", channelMatch: "trusted", publishedAt: "2026-01-01T00:00:00Z" },
          [{ videoId: "solo", title: "Big Name | Boiler Room Berlin", channelTitle: "Boiler Room", channelMatch: "trusted", publishedAt: "2024-01-01T00:00:00Z" }],
        ),
      ],
    );
    expect(s.events[0]).toMatchObject({
      outcome: "headliner_b2b_outsider_with_verified_solo",
      simulated: { videoId: "solo", reason: "headliner_solo_from_evidence", changesFromToday: true },
    });
    expect(s.events[0].headliners[0].verifiedAlternatives).toEqual([expect.objectContaining({ videoId: "solo", solo: true })]);
    expect(s.safeAlternatesNeed.solvableOnlyFromEvidence).toBe(1);
  });

  it("a B2B whose partner also performs is fine as it is", () => {
    const night = event({ id: "e3", artists: ["Big Name", "Partner Act"], description: "Big Name headlines the night." });
    const s = buildEventSection(
      [night],
      [accepted("big name", "Big Name", { videoId: "v", title: "Big Name b2b Partner Act - Live", channelTitle: "Big Name" })],
    );
    expect(s.events[0]).toMatchObject({ outcome: "ok_headliner_shown", simulated: { reason: "headliner_b2b_in_lineup", changesFromToday: false } });
  });

  it("a headliner shown today with a solo video is ok and unchanged", () => {
    const night = event({ id: "e4", artists: ["Big Name", "Opener Act"], description: "Big Name headlines the night." });
    const s = buildEventSection([night], [accepted("big name", "Big Name", { videoId: "v", title: "Big Name - Live at Home", channelTitle: "Big Name" })]);
    expect(s.events[0]).toMatchObject({ outcome: "ok_headliner_shown", simulated: { reason: "headliner_solo", changesFromToday: false } });
  });

  it("when the headliner has no video, only a strong, clearly identified match of another performer is used", () => {
    const night = event({ id: "e5", artists: ["Big Name", "Opener Act"], description: "Big Name headlines the night." });
    const s = buildEventSection([night], [abstain("big name"), accepted("opener act", "Opener Act", { videoId: "op", title: "Opener Act - Live", channelTitle: "Opener Act" })]);
    expect(s.events[0]).toMatchObject({ outcome: "headliner_no_match", strongFallbacks: ["Opener Act"], simulated: { reason: "fallback_strong", changesFromToday: false } });
  });

  it("never prioritizes when no headliner is documented or prioritized — today's choice stays", () => {
    const night = event({ id: "e6", artists: ["Alpha", "Bravo", "Charlie", "Delta"] });
    const s = buildEventSection([night], [accepted("charlie", "Charlie", { videoId: "c", title: "Charlie - Live", channelTitle: "Charlie" })]);
    expect(s.events[0]).toMatchObject({ outcome: "no_prioritized_headliner", outcomeDetail: "other", simulated: { reason: "no_prioritized_headliner", changesFromToday: false } });
  });

  it("a manually blocked headliner is never shown or simulated", () => {
    const night = event({ id: "e7", artists: ["Big Name", "Opener Act"], description: "Big Name headlines the night." });
    const s = buildEventSection([night], [accepted("big name", "Big Name", { videoId: "v", title: "Big Name - Live", channelTitle: "Big Name" }, [], true)]);
    expect(s.events[0].headliners[0]).toMatchObject({ cacheStatus: "blocked", video: null });
    expect(s.events[0].shownToday).toBeNull();
  });
});

describe("buildEventSection — manual choices are always respected", () => {
  const night = event({ id: "e-a2b5cf47", artists: ["Opener Act", "Big Name"], description: "Big Name headlines the night." });
  const cache = [
    accepted("opener act", "Opener Act", { videoId: "op", title: "Opener Act - Live", channelTitle: "Opener Act" }),
    accepted("big name", "Big Name", { videoId: "big", title: "Big Name - Live", channelTitle: "Big Name" }),
  ];

  it("an event with a hidden override (#166) is left out of the simulation", () => {
    const s = buildEventSection([night], cache, [{ event_id: "e-a2b5cf47", mode: "hidden", video_id: null, available: true }]);
    expect(s.eventOverrides).toEqual({ rows: 1 });
    expect(s.events[0]).toMatchObject({
      outcome: "manual_event_override",
      shownToday: null,
      manualOverride: { mode: "hidden", videoId: null },
      simulated: { reason: "manual_choice_kept", changesFromToday: false, requiresVisibleArtistName: false },
    });
  });

  it("any override mode — even an unknown one — counts as a manual choice", () => {
    const s = buildEventSection([night], cache, [{ event_id: "e-a2b5cf47", mode: "something-new", video_id: "x", available: false }]);
    expect(s.events[0].outcome).toBe("manual_event_override");
  });

  it("an available override video is what the page shows today, exactly as getEventYoutubePreview does", () => {
    const s = buildEventSection([night], cache, [
      { event_id: "e-a2b5cf47", mode: "video", video_id: "Pbb0KmuwYSA", video_title: "steamboi | REX Radio (10.11.25)", channel_title: "REX Radio", artist_name: "Big Name", available: true },
    ]);
    expect(s.events[0]).toMatchObject({
      outcome: "manual_event_override",
      shownTodayBasis: "event_override_video",
      shownToday: { artist: "Big Name", videoId: "Pbb0KmuwYSA", source: "event_override", isHeadliner: true, proposedFailures: [] },
      manualOverride: { decision: "video" },
      simulated: { videoId: "Pbb0KmuwYSA", reason: "manual_choice_kept", changesFromToday: false },
    });
  });

  it("an unavailable override video shows nothing and never falls back to the artist match", () => {
    const s = buildEventSection([night], cache, [{ event_id: "e-a2b5cf47", mode: "video", video_id: "Pbb0KmuwYSA", available: false }]);
    expect(s.events[0]).toMatchObject({ shownToday: null, shownTodayBasis: "event_override_none", manualOverride: { decision: "none" } });
  });

  it("an override without artist name names no artist, like the page — never a guess from the lineup", () => {
    const s = buildEventSection([night], cache, [{ event_id: "e-a2b5cf47", mode: "video", video_id: "Pbb0KmuwYSA", available: true }]);
    expect(s.events[0].shownToday).toMatchObject({ artist: null, videoId: "Pbb0KmuwYSA", isHeadliner: false });
  });

  it("without the override table Production fails closed: no video is shown today anywhere", () => {
    const s = buildEventSection([night], cache, "table_not_present");
    expect(s.eventOverrides).toBe("table_not_present");
    expect(s.productionFailsClosed).toBe(true);
    expect(s.events[0]).toMatchObject({ shownToday: null, shownTodayBasis: "override_table_missing" });
  });

  it("an event without an override row shows the automated artist match", () => {
    const s = buildEventSection([night], cache, []);
    expect(s.productionFailsClosed).toBe(false);
    expect(s.events[0]).toMatchObject({ shownTodayBasis: "artist_cache", shownToday: { artist: "Opener Act", source: "artist_cache" }, outcome: "headliner_has_video_not_shown" });
  });

  it("a video shown today from a manual artist pin (#163) is never replaced", () => {
    const pinned = { ...accepted("opener act", "Opener Act", { videoId: "pin", title: "Opener Act | REX Radio", channelTitle: "REX Radio" }), match_rule: "manual", evidence: {} };
    const s = buildEventSection([night], [pinned, cache[1]]);
    expect(s.events[0]).toMatchObject({
      outcome: "manual_artist_pin",
      shownToday: { artist: "Opener Act", manualPin: true },
      simulated: { artist: "Opener Act", videoId: "pin", reason: "manual_choice_kept", changesFromToday: false },
    });
  });
});

describe("buildEventSection — fallback must name the artist visibly", () => {
  it("only a fallback to another performer requires a visible artist name", () => {
    const night = event({ id: "f1", artists: ["Big Name", "Opener Act"], description: "Big Name headlines the night." });
    const fallback = buildEventSection([night], [abstain("big name"), accepted("opener act", "Opener Act", { videoId: "op", title: "Opener Act - Live", channelTitle: "Opener Act" })]);
    expect(fallback.events[0].simulated).toMatchObject({ reason: "fallback_strong", requiresVisibleArtistName: true });
    const own = buildEventSection([night], [accepted("big name", "Big Name", { videoId: "v", title: "Big Name - Live", channelTitle: "Big Name" })]);
    expect(own.events[0].simulated).toMatchObject({ reason: "headliner_solo", requiresVisibleArtistName: false });
  });
});

describe("shownPreviewArtist — same choice as the event page", () => {
  it("takes the first lineup entry (by first occurrence of its normalized name) with an accepted, unblocked video", () => {
    const cache = new Map([
      ["b", accepted("b", "B", { videoId: "vb", title: "B", channelTitle: "B" })],
      ["a", accepted("a", "A", { videoId: "va", title: "A", channelTitle: "A" }, [], true)],
    ]);
    expect(shownPreviewArtist(["A", "B", "b"], cache)?.row.video_id).toBe("vb");
    expect(shownPreviewArtist(["A"], cache)).toBeNull();
  });
});

describe("buildEventSection — prose/order dependency is measured, not assumed", () => {
  it("counts events whose prose names the lineup's first entry first", () => {
    const s = buildEventSection(
      [
        event({ id: "p1", artists: ["First", "Second"], description: "First is back." }),
        event({ id: "p2", artists: ["First", "Second"], description: "Second returns with First." }),
      ],
      [],
    );
    expect(s.proseOrderAgreement).toEqual({ eventsWithProse: 2, proseFirstEqualsLineupFirst: 1 });
  });
});

describe("summarizeDecision — the owner's decision basis", () => {
  const headlined = event({ id: "h1", artists: ["Opener Act", "Big Name"], description: "Big Name headlines the night." });
  const kept = event({ id: "e-a2b5cf47", artists: ["Opener Act", "Big Name"], description: "Big Name headlines the night." });
  const b2b = event({ id: "b1", artists: ["Luke Slater"], description: "Luke Slater headlines." });
  const cache = [
    accepted("opener act", "Opener Act", { videoId: "op", title: "Opener Act - Live", channelTitle: "Opener Act" }),
    accepted("big name", "Big Name", { videoId: "big", title: "Big Name - Live", channelTitle: "Big Name" }),
    accepted("luke slater", "Luke Slater", { videoId: "ls", title: "Luke Slater b2b Chris Liebing - Live", channelTitle: "Luke Slater" }),
  ];
  const d = buildEventSection([headlined, kept, b2b], cache, [{ event_id: "e-a2b5cf47", mode: "hidden", video_id: null, available: true }]).decision;

  it("counts who is shown against the prioritized headliner", () => {
    expect(d).toMatchObject({ visibleEvents: 3, eventsShowingVideo: 2, prioritizedEvents: 3, shownIsHeadliner: 1, shownIsOtherArtist: 1, shownNothing: 1 });
  });

  it("lists another artist shown while the headliner has a usable cached video, never a manual choice", () => {
    expect(d.otherShownWhileHeadlinerHasCachedVideo).toEqual(["h1"]);
  });

  it("lists a B2B with a partner who does not perform", () => {
    expect(d.b2bShownWithNonPerformer).toEqual(["b1"]);
  });

  it("lists every change from → to, with manual choices left out", () => {
    expect(d.manualChoicesKept).toBe(1);
    expect(d.changes).toEqual([{ slug: "h1", from: { artist: "Opener Act", videoId: "op" }, to: { artist: "Big Name", videoId: "big" }, reason: "headliner_solo", requiresVisibleArtistName: false }]);
    expect(d.solvableWithVerifiedVideos).toEqual({ fromCacheRow: 1, fromStoredEvidenceOnly: 0, otherPerformerFallback: 0 });
  });

  it("names how each headliner was inferred", () => {
    expect(Object.values(d.headlinerBasis).reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("buildEventSection — missing evidence is not 'no suitable video'", () => {
  it("a headliner whose search evidence was overwritten by a former manual pin is reported as evidence missing", () => {
    const night = event({ id: "e-cfb6beb2", artists: ["STEAMBOI", "Opener"], description: "STEAMBOI headlines the night." });
    const released: CacheRow = { artist_name_normalized: "steamboi", status: "abstain", match_rule: null, video_id: null, video_title: null, channel_title: null, manual_block: false, evidence: {} };
    const s = buildEventSection([night], [released], []);
    expect(s.events[0]).toMatchObject({ outcome: "headliner_evidence_missing", headliners: [{ artist: "STEAMBOI", cacheStatus: "abstain_no_evidence" }] });
    expect(s.decision.missingSuitableVideo).toMatchObject({ headlinerEvidenceMissing: 1, prioritizedHeadlinerWithoutMatch: 0 });
  });

  it("a searched abstain stays headliner_no_match", () => {
    const night = event({ id: "n1", artists: ["Big Name"], description: "Big Name headlines." });
    expect(buildEventSection([night], [abstain("big name")], []).events[0].outcome).toBe("headliner_no_match");
  });
});
