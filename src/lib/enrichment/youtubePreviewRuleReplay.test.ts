import { describe, expect, it } from "vitest";
import {
  nameInBillingPosition,
  parseEvidence,
  proposedRuleFailures,
  replayAcceptedRow,
  trustedChannelSpaceContinuationOk,
} from "./youtubePreviewRuleReplay";

type Channel = "own" | "trusted";

interface FixtureCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  channelMatch?: Channel;
  publishedAt?: string;
  /** Present = it was verified; false = verified but not technically safe. */
  safe?: boolean;
  eligible?: boolean;
}

/** Builds evidence exactly in the shape youtubePreviewMatching.ts stores it. */
function attempt(query: string, candidates: FixtureCandidate[], selectedId: string | null) {
  const eligible = candidates.filter((c) => c.eligible !== false);
  const rejected = candidates.filter((c) => c.eligible === false);
  const selected = eligible.find((c) => c.videoId === selectedId) ?? null;
  return {
    query,
    candidatesReturned: candidates.length,
    structurallyEligible: eligible.map((c) => ({
      videoId: c.videoId,
      title: c.title,
      channelId: `ch-${c.channelTitle}`,
      channelTitle: c.channelTitle,
      channelMatch: c.channelMatch ?? "own",
      publishedAt: c.publishedAt ?? "2025-01-01T00:00:00Z",
    })),
    rejected: rejected.map((c) => ({ videoId: c.videoId, title: c.title, channelTitle: c.channelTitle, reason: "ineligible" })),
    verified: candidates
      .filter((c) => c.safe !== undefined)
      .map((c) => ({ videoId: c.videoId, durationSeconds: c.safe ? 3600 : 60, embeddable: true, privacyStatus: "public" })),
    selected: selected
      ? { videoId: selected.videoId, title: selected.title, channelId: `ch-${selected.channelTitle}`, channelTitle: selected.channelTitle, channelMatch: selected.channelMatch ?? "own" }
      : null,
    rejectedAfterVerification: [],
  };
}

function row(name: string, selected: FixtureCandidate, others: FixtureCandidate[] = [], opts: { fallback?: ReturnType<typeof attempt> } = {}) {
  const primary = attempt(`${name} dj set`, [selected, ...others], selected.videoId);
  return {
    artistNameNormalized: name.toLowerCase(),
    videoId: selected.videoId,
    videoTitle: selected.title,
    channelTitle: selected.channelTitle,
    manualBlock: false,
    evidence: { rawArtistName: name, cleanedName: name, primaryAttempt: primary, fallbackAttempt: opts.fallback ?? null },
  };
}

describe("proposed rule: trusted-channel space continuation", () => {
  it("rejects DASHA inside \"Dasha Rush\" on Boiler Room", () => {
    expect(trustedChannelSpaceContinuationOk("Dasha Rush Boiler Room x Present Perfect Festival DJ Set", "DASHA", "Boiler Room")).toBe(false);
  });

  it.each([
    ["Cassie Raptor | Boiler Room: Paris", "Cassie Raptor", "Boiler Room"],
    ["Oliver Koletzki Boiler Room Berlin DJ Set", "Oliver Koletzki", "Boiler Room"],
    ["Chris Liebing B2B Luke Slater | Boiler Room: Warsaw", "Luke Slater", "Boiler Room"],
    ["MCR-T | Boiler Room Berlin: Live From Earth", "MCR-T", "Boiler Room"],
    ["Sub Focus WE1 | Tomorrowland 2025", "Sub Focus", "Tomorrowland"],
    ["Oscar Mulero | Boiler Room x BAU Gijón", "Oscar Mulero", "Boiler Room"],
    ["Miley Serious | Boiler Room: Melbourne", "Miley Serious", "Boiler Room"],
    ["Ben UFO b2b Joy Orbison | Boiler Room", "Ben UFO", "Boiler Room"],
    ["Peggy Gou live at Boiler Room", "Peggy Gou", "Boiler Room"],
  ])("keeps %s", (title, name, channel) => {
    expect(trustedChannelSpaceContinuationOk(title, name, channel)).toBe(true);
  });
});

describe("proposed rule: name in billing position", () => {
  it("rejects Intercell named only as the venue/event", () => {
    expect(nameInBillingPosition("Benwal b2b Sam Alfred at Intercell x Glitch Festival 2026 | Full set", "Intercell")).toBe(false);
  });

  it("rejects ADELINA named only after a description", () => {
    expect(nameInBillingPosition("AFRO DJ AUDIO SET 2026 - ADELINA.", "ADELINA")).toBe(false);
  });

  it.each([
    ["Jai Taylor b2b Friend Of Mine - Revolve Festival 2026", "Jai Taylor"],
    ["Saidah Live @ Bravo Lowlands Festival 2026", "Saidah"],
    ["Icona Pop - DJ Set at LAVO NYC", "Icona Pop"],
    ["Onsberg - When we go Down", "ONSBERG"],
    ["TRINIX - LIVE @ LYON (Les Nuits de Fourvière)", "Trinix"],
    ["Guy J - Live from Balance Croatia Festival 2025", "GUY J"],
    ["Simone Zino — Live at Shelter Space Warehouse | Hypnotic &amp; Groovy Techno", "SIMONE ZINO"],
    ["EZEQUIEL PERINI 🇦🇷 | UNBOXED SESSION at CULTURE BOX - Copenhagen - Denmark 2026", "EZEQUIEL PERINI"],
    ["CøkiT |Amsterdam Most wanted Dj Marathon (AMW) x ADE | 23 Oct 2025", "CØKIT"],
    ["Chris Liebing B2B Luke Slater | Boiler Room: Warsaw", "Luke Slater"],
    ["Sub Focus WE1 | Tomorrowland 2025", "Sub Focus"],
    ["[FULL SET] Peggy Gou | Boiler Room", "Peggy Gou"],
  ])("keeps %s", (title, name) => {
    expect(nameInBillingPosition(title, name)).toBe(true);
  });
});

describe("proposedRuleFailures — every accepted match from the 2026-10 batches", () => {
  // The identity-doubtful three must fail; every other accepted match must
  // pass both proposed rules untouched.
  it.each([
    ["Dasha Rush Boiler Room x Present Perfect Festival DJ Set", "DASHA", "Boiler Room", "trusted", ["trusted_channel_space_continuation"]],
    ["Benwal b2b Sam Alfred at Intercell x Glitch Festival 2026 | Full set", "Intercell", "Intercell", "own", ["name_in_billing_position"]],
    ["AFRO DJ AUDIO SET 2026 - ADELINA.", "ADELINA", "Adelina", "own", ["name_in_billing_position"]],
    ["Jai Taylor b2b Friend Of Mine - Revolve Festival 2026", "Jai Taylor", "Jai Taylor", "own", []],
    ["Saidah Live @ Bravo Lowlands Festival 2026", "Saidah", "Saidah", "own", []],
    ["CøkiT |Amsterdam Most wanted Dj Marathon (AMW) x ADE | 23 Oct 2025", "CØKIT", "CøkiT", "own", []],
    ["Onsberg - When we go Down", "ONSBERG", "Onsberg", "own", []],
    ["Cassie Raptor | Boiler Room: Paris", "Cassie Raptor", "Boiler Room", "trusted", []],
    ["Icona Pop - DJ Set at LAVO NYC", "Icona Pop", "Icona Pop", "own", []],
    ["Oliver Koletzki Boiler Room Berlin DJ Set", "Oliver Koletzki", "Boiler Room", "trusted", []],
    ["Miley Serious | Boiler Room: Melbourne", "Miley Serious", "Boiler Room", "trusted", []],
    ["Chris Liebing B2B Luke Slater | Boiler Room: Warsaw", "Luke Slater", "Boiler Room", "trusted", []],
    ["Oscar Mulero | Boiler Room x BAU Gijón", "Oscar Mulero", "Boiler Room", "trusted", []],
    ["Simone Zino — Live at Shelter Space Warehouse | Hypnotic &amp; Groovy Techno", "SIMONE ZINO", "Simone Zino", "own", []],
    ["MCR-T | Boiler Room Berlin: Live From Earth", "MCR-T", "Boiler Room", "trusted", []],
    ["TRINIX - LIVE @ LYON (Les Nuits de Fourvière)", "Trinix", "TRINIX", "own", []],
    ["EZEQUIEL PERINI 🇦🇷 | UNBOXED SESSION at CULTURE BOX - Copenhagen - Denmark 2026", "EZEQUIEL PERINI", "EZEQUIEL PERINI", "own", []],
    ["Guy J - Live from Balance Croatia Festival 2025", "GUY J", "Guy J", "own", []],
    ["Sub Focus WE1 | Tomorrowland 2025", "Sub Focus", "Tomorrowland", "trusted", []],
  ] as const)("%s", (title, name, channel, match, expected) => {
    expect(proposedRuleFailures(title, name, channel, match)).toEqual(expected);
  });
});

describe("replayAcceptedRow", () => {
  it("keeps a match that passes every rule as unchanged — even when a newer safe candidate exists", () => {
    const result = replayAcceptedRow(
      row(
        "Cassie Raptor",
        { videoId: "cur", title: "Cassie Raptor | Boiler Room: Paris", channelTitle: "Boiler Room", channelMatch: "trusted", publishedAt: "2023-01-01T00:00:00Z", safe: true },
        [{ videoId: "newer", title: "Cassie Raptor | Boiler Room: London", channelTitle: "Boiler Room", channelMatch: "trusted", publishedAt: "2026-01-01T00:00:00Z", safe: true }],
      ),
    );
    expect(result).toMatchObject({ outcome: "unchanged", proposedFailures: [], failsCurrentRules: false, alternative: null, matchedOn: "primary" });
  });

  it("DASHA: no other candidate passes and no fallback was run → needs_fallback_query", () => {
    const result = replayAcceptedRow(
      row("DASHA", { videoId: "WRFXZHZpvfU", title: "Dasha Rush Boiler Room x Present Perfect Festival DJ Set", channelTitle: "Boiler Room", channelMatch: "trusted", safe: true }),
    );
    expect(result.outcome).toBe("needs_fallback_query");
    expect(result.proposedFailures).toContain("trusted_channel_space_continuation");
    expect(result.alternative).toBeNull();
  });

  it("offers an already-verified stored candidate that passes every rule as a review-only alternative", () => {
    const result = replayAcceptedRow(
      row("Intercell", { videoId: "Ozv-gv4Tywc", title: "Benwal b2b Sam Alfred at Intercell x Glitch Festival 2026 | Full set", channelTitle: "Intercell", safe: true }, [
        { videoId: "alt", title: "Intercell - Live at Glitch 2025", channelTitle: "Intercell", safe: true },
      ]),
    );
    expect(result).toMatchObject({ outcome: "other_candidate_available", alternative: { videoId: "alt" } });
  });

  it("never offers an alternative that was not verified, or failed verification", () => {
    const result = replayAcceptedRow(
      row("ADELINA", { videoId: "axkFsBI2E6U", title: "AFRO DJ AUDIO SET 2026 - ADELINA.", channelTitle: "Adelina", safe: true }, [
        { videoId: "unverified", title: "Adelina - House Mix", channelTitle: "Adelina" },
        { videoId: "too-short", title: "Adelina - Teaser", channelTitle: "Adelina", safe: false },
      ]),
    );
    expect(result).toMatchObject({ outcome: "needs_fallback_query", alternative: null, unverifiedPassingCandidates: 1 });
  });

  it("a fallback-query match with nothing else passing → would_abstain", () => {
    const fallback = attempt("Adelina live", [{ videoId: "axkFsBI2E6U", title: "AFRO DJ AUDIO SET 2026 - ADELINA.", channelTitle: "Adelina", safe: true }], "axkFsBI2E6U");
    const r = row("ADELINA", { videoId: "x", title: "unrelated", channelTitle: "Other", eligible: false }, [], { fallback });
    r.videoId = "axkFsBI2E6U";
    const result = replayAcceptedRow(r);
    expect(result).toMatchObject({ outcome: "would_abstain", matchedOn: "fallback" });
  });

  it("flags a match today's production rules no longer accept (made before the 2026-09-29 short-suffix guard)", () => {
    const result = replayAcceptedRow(
      row("Benji", { videoId: "benjib", title: "Benji B | Boiler Room London", channelTitle: "Boiler Room", channelMatch: "trusted", safe: true }),
    );
    expect(result.failsCurrentRules).toBe(true);
    expect(result.currentRulesReason).toMatch(/distinct stage name/);
    expect(result.outcome).not.toBe("unchanged");
  });

  it("reports a row with no replayable evidence as not_replayable instead of guessing", () => {
    expect(replayAcceptedRow({ artistNameNormalized: "x", videoId: "v", videoTitle: "t", channelTitle: "c", manualBlock: false, evidence: [] }).outcome).toBe("not_replayable");
    expect(replayAcceptedRow({ artistNameNormalized: "x", videoId: "v", videoTitle: "t", channelTitle: "c", manualBlock: false, evidence: { primaryAttempt: attempt("x dj set", [], null) } }).outcome).toBe("not_replayable");
  });

  it("parses evidence stored before the recency change (no publishedAt) without failing", () => {
    const ev = row("Saidah", { videoId: "s", title: "Saidah Live @ Bravo", channelTitle: "Saidah", safe: true }).evidence as { primaryAttempt: { structurallyEligible: Record<string, unknown>[] } };
    for (const c of ev.primaryAttempt.structurallyEligible) delete c.publishedAt;
    expect(parseEvidence(ev, "saidah")?.primary?.candidates[0].publishedAt).toBe("");
    expect(replayAcceptedRow({ artistNameNormalized: "saidah", videoId: "s", videoTitle: "Saidah Live @ Bravo", channelTitle: "Saidah", manualBlock: false, evidence: ev }).outcome).toBe("unchanged");
  });
});
