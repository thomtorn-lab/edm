import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  handleOf,
  evidenceForCandidate,
  evidenceForStoredEvent,
  extractSourceSoundcloudEvidence,
  findKeyConflicts,
  reusableProfilesByKey,
  type SoundcloudEvidence,
} from "./sourceEvidence";
import { parseCultureBoxEventsHtml } from "../adapters/cultureBoxAdapter";
import { parseHangarenEventsHtml } from "../adapters/hangarenAdapter";
import { classifyAppearance, splitLineupEntry } from "../artistIdentity/lineupIdentity";
import { evidenceBacksAppearance } from "../artistIdentity/evidence";

const AT = new Date("2026-10-24T12:00:00.000Z");

const FIX = path.join(__dirname, "..", "adapters", "__fixtures__");
const read = (f: string) => readFileSync(path.join(FIX, f), "utf-8");
const pairs = (records: SoundcloudEvidence[]) => records.map((r) => [r.entry, handleOf(r.url), r.signal, r.conflict?.kind ?? null]);
const run = (artists: string[], text: string) =>
  extractSourceSoundcloudEvidence({ artists, texts: [text], sourceId: "src-x", eventId: "e-x", sourceUrl: null, observedAt: AT });

describe("source_anchor: the adapter's structured lineup links (Culture Box, real recorded listings)", () => {
  const all = ["culture-box-events.html", "culture-box-events-2026-10-13.html"].flatMap((f) =>
    parseCultureBoxEventsHtml(read(f)).flatMap((e) => evidenceForCandidate(e, { eventId: null, observedAt: AT })),
  );

  it("one record per linked lineup name, all source_anchor (194 across both listings)", () => {
    expect(all).toHaveLength(194);
    expect(new Set(all.map((r) => r.signal))).toEqual(new Set(["source_anchor"]));
    expect(all.find((r) => r.entry === "REXIE LEX")).toMatchObject({ key: "rexie lex", url: "https://soundcloud.com/rexie_lex", sourceId: "src-culture-box" });
  });

  it("REGRESSION LELE/LeLe: one identity key, two different profiles, never decided by the name", () => {
    const lele = findKeyConflicts(all).filter((r) => r.key === "lele");
    expect(pairs(lele).sort()).toEqual([
      ["LELE", "user-442274348", "source_anchor", "two_handles_same_key"],
      ["LeLe", "user-339333395", "source_anchor", "two_handles_same_key"],
    ]);
    expect(reusableProfilesByKey(all).has("lele")).toBe(false);
    // conflicted evidence never backs an appearance, not even on its own event: review until an admin splits them
    expect(lele.some((r) => evidenceBacksAppearance(r))).toBe(false);
  });

  it("a linked collective or duo is evidence for review, never for one artist (MSW COLLECTIVE, BONGO & PUSK)", () => {
    const flagged = all.filter((r) => r.conflict).map((r) => [r.entry, r.conflict!.kind]);
    expect(flagged.sort()).toEqual([
      ["BONGO & PUSK", "entry_not_single_artist"],
      ["MSW COLLECTIVE", "entry_not_single_artist"],
    ]);
  });

  it("distinctive verified names are reusable on other events (Rexie Lex, Eusherr, B From E at Hangaren/admin events)", () => {
    const reuse = reusableProfilesByKey(all);
    expect(reuse.get("rexie lex")).toBe("https://soundcloud.com/rexie_lex");
    expect(reuse.get("eusherr")).toBe("https://soundcloud.com/eusherr");
    expect(reuse.get("b from e")).toBe("https://soundcloud.com/bfrome");
  });
});

describe("source_inline: 'Name … URL' in the source's own text", () => {
  it("Hangaren (real recorded page): lineup lines keep the venue's links via lineupSourceText", () => {
    const night = parseHangarenEventsHtml(read("hangaren-events.html"), "https://www.hangaren.dk/events").find((e) =>
      e.artists.includes("Kromagon"),
    )!;
    expect(night.lineupSourceText).toContain("https://soundcloud.com/aragon");
    expect(night.artists.join(" ")).not.toContain("soundcloud");
    expect(pairs(evidenceForCandidate(night, { eventId: null, observedAt: AT }))).toEqual([
      // the stored entry is the adapter's label residue: a label shape, so review only
      ["Fagins Reject – Wild Things Records: - Wild things Records", "fagins_reject", "source_inline", "entry_not_single_artist"],
      ["Kromagon", "aragon", "source_inline", null], // handle differs from the name; the venue says so
      ["Oxyflux", "oxyflux_music", "source_inline", null],
      ["Shenanigan", "shenaniganmusic", "source_inline", null],
      ["Freya Rose", "freyarosecomingup", "source_inline", null],
      ["Mental Projection", "mentalprojectionlive", "source_inline", null],
      ["Krypto", "psykrypp", "source_inline", null],
      // a duo with one link each: neither profile is credited to the duo entry
      ["Lulla-Li & Nihility", "tenna-li-andersen", "source_inline", "entry_not_single_artist"],
      ["Lulla-Li & Nihility", "nihility_forest", "source_inline", "entry_not_single_artist"],
      ["Merlyn Silva & Matt Nørgaard", "merlyn", "source_inline", "entry_not_single_artist"],
      ["Merlyn Silva & Matt Nørgaard", "mattnorgaard", "source_inline", "entry_not_single_artist"],
    ]);
  });

  it("the collective's own 'SC: …' link is not attached to anyone", () => {
    const night = parseHangarenEventsHtml(read("hangaren-events.html"), "https://www.hangaren.dk/events").find((e) =>
      e.artists.includes("Kromagon"),
    )!;
    expect(evidenceForCandidate(night, { eventId: null, observedAt: AT }).map((r) => handleOf(r.url))).not.toContain("arcanumartistcollective");
  });

  it("Pylonen Payday (stored description, real Production text 2026-10-16, abridged): names before links, Mixcloud ends a label", () => {
    const description =
      "PAYDAYMON has decided to throw a party and hire everyone from the house. Xulipa mirr (Zeitgeist) https://soundcloud.com/mirulstrup " +
      "SEID (Frikvens Syndikatet) https://soundcloud.com/seid1312 https://www.mixcloud.com/frikvenssyndikatet " +
      "L.A.D.J. (Drum and Bass Klubben) https://soundcloud.com/darealadj Small Horse (Fluid Sound Collective) https://soundcloud.com/small-horse";
    const records = evidenceForStoredEvent({
      id: "e-edc0cfd4",
      canonicalSourceId: "src-pylonen",
      artists: ["Xulipa", "mirr", "SEID", "L.A.D.J.", "Small Horse", "Fremond", "ちとく", "Pitch B Itch", "Natq"],
      description,
      officialEventUrl: "https://pylonen.horse/pylonen-payday/",
    }, AT);
    expect(pairs(records)).toEqual([
      ["mirr", "mirulstrup", "source_inline", null],
      ["SEID", "seid1312", "source_inline", null],
      ["L.A.D.J.", "darealadj", "source_inline", null],
      ["Small Horse", "small-horse", "source_inline", null],
    ]);
    expect(records.every((r) => r.eventId === "e-edc0cfd4" && r.sourceId === "src-pylonen")).toBe(true);
  });

  it("an anchor in HTML text works the same as a bare URL", () => {
    expect(pairs(run(["Kromagon"], 'Kromagon: <a href="https://soundcloud.com/aragon">listen</a>'))).toEqual([["Kromagon", "aragon", "source_inline", null]]);
  });
});

describe("never invents a link", () => {
  it("a name in the middle of prose is not paired with a following URL", () => {
    expect(run(["Benwal", "S3PPA"], "his track Power was played by Benwal during Awakenings https://soundcloud.com/s3ppa")).toEqual([]);
  });

  it("only lineup names: a label that is not in the lineup gets nothing", () => {
    expect(run(["Kromagon"], "SC: https://soundcloud.com/arcanumartistcollective")).toEqual([]);
  });

  it("tracks, sets, reserved paths and label/organisation handles are not profiles", () => {
    const text = [
      "Kromagon: https://soundcloud.com/aragon/some-track",
      "Kromagon: https://soundcloud.com/aragon/sets/mix",
      "Kromagon: https://soundcloud.com/discover",
      "Kromagon: https://soundcloud.com/zenonrecords",
    ].join("\n");
    expect(run(["Kromagon"], text)).toEqual([]);
  });

  it("a B2B side gets the profile as its own performer, not the whole B2B entry", () => {
    const [r] = run(["Ingvil B2B DJ Void"], "DJ Void https://soundcloud.com/djvoid");
    expect(r).toMatchObject({ entry: "Ingvil B2B DJ Void", part: "DJ Void", key: "dj void", conflict: null });
  });

  it("a label that answers to two lineup positions is not paired (DJ Void alone and inside a B2B)", () => {
    expect(run(["Ingvil B2B DJ Void", "DJ Void"], "DJ Void https://soundcloud.com/djvoid")).toEqual([]);
  });

  it("one artist with two different profiles in the same event is a conflict, not a choice", () => {
    expect(pairs(run(["Krypto"], "Krypto: https://soundcloud.com/psykrypp https://soundcloud.com/krypto-2"))).toEqual([
      ["Krypto", "psykrypp", "source_inline", "two_handles_same_event"],
      ["Krypto", "krypto-2", "source_inline", "two_handles_same_event"],
    ]);
  });

  it("names guessed from the title never get evidence", () => {
    expect(
      evidenceForCandidate({
        sourceId: "src-kultunaut",
        sourceUrl: "https://www.kultunaut.dk/x",
        artists: ["Kromagon"],
        description: "Kromagon: https://soundcloud.com/aragon",
        relevanceText: null,
        artistsGuessedFromTitle: true,
      }, { eventId: null, observedAt: AT }),
    ).toEqual([]);
  });
});

describe("reuse across events (approved rules: distinctive names only)", () => {
  const rec = (entry: string, handle: string, conflict: SoundcloudEvidence["conflict"] = null): SoundcloudEvidence => ({
    kind: "soundcloud_profile",
    entry,
    part: entry,
    key: entry.toLowerCase(),
    url: `https://soundcloud.com/${handle}`,
    signal: "source_inline",
    sourceId: "src-x",
    eventId: null,
    sourceUrl: null,
    observedAt: AT,
    conflict,
  });

  it("short names keep their own event's evidence but are never reused by name (SEID, mirr)", () => {
    const reuse = reusableProfilesByKey([rec("SEID", "seid1312"), rec("mirr", "mirulstrup"), rec("Small Horse", "small-horse")]);
    expect([...reuse.keys()]).toEqual(["small horse"]);
  });

  it("a key with any conflict anywhere is never reused", () => {
    expect(reusableProfilesByKey([rec("Krypto", "psykrypp"), rec("Krypto", "krypto-2")]).size).toBe(0);
  });

  it("Small Horse at Pylonen and the unlinked SMALL HORSE at Culture Box share one key (a reuse candidate, decided by the shared model)", () => {
    const pylonen = evidenceForStoredEvent({
      id: "e-p",
      canonicalSourceId: "src-pylonen",
      artists: ["Small Horse"],
      description: "Small Horse (Fluid Sound Collective) https://soundcloud.com/small-horse",
      officialEventUrl: null,
    }, AT);
    expect(reusableProfilesByKey(pylonen).get(pylonen[0].key)).toBe("https://soundcloud.com/small-horse");
    expect(pylonen[0].key).toBe(classifyAppearance({ entry: "SMALL HORSE", part: splitLineupEntry("SMALL HORSE")[0], eventTitle: "x", lineupSize: 5, hasSourceHandle: false, venueKeys: new Set() }).key);
  });
});

describe("the shared IdentityEvidence contract", () => {
  it("every record is kind soundcloud_profile with a source_* signal and the observation time", () => {
    const [r] = run(["Kromagon"], "Kromagon: https://soundcloud.com/aragon");
    expect(r).toEqual({
      kind: "soundcloud_profile",
      entry: "Kromagon",
      part: "Kromagon",
      key: "kromagon",
      url: "https://soundcloud.com/aragon",
      signal: "source_inline",
      sourceId: "src-x",
      eventId: "e-x",
      sourceUrl: null,
      observedAt: AT,
      conflict: null,
    });
  });

  it("evidenceBacksAppearance: a clean record on a known event backs it; conflicts and candidate (eventless) records never do", () => {
    const [clean] = run(["Kromagon"], "Kromagon: https://soundcloud.com/aragon");
    const [duo] = run(["Lulla-Li & Nihility"], "Lulla-Li & Nihility: https://soundcloud.com/nihility_forest");
    expect(evidenceBacksAppearance(clean)).toBe(true);
    expect(evidenceBacksAppearance(duo)).toBe(false);
    expect(evidenceBacksAppearance({ ...clean, eventId: null })).toBe(false);
  });

  it("an admin-created event (no canonical source) yields no evidence until the model defines its attribution", () => {
    expect(
      evidenceForStoredEvent({ id: "e-a", canonicalSourceId: null, artists: ["Kromagon"], description: "Kromagon: https://soundcloud.com/aragon", officialEventUrl: null }, AT),
    ).toEqual([]);
  });
});

describe("feeds the shared model's appearance classification", () => {
  it("a short name with the source's own handle is 'high' (source handle beats short), without one it is 'review'", () => {
    const records = run(["SEID"], "SEID (Frikvens Syndikatet) https://soundcloud.com/seid1312");
    const classify = (hasSourceHandle: boolean) =>
      classifyAppearance({ entry: "SEID", part: splitLineupEntry("SEID")[0], eventTitle: "Pylonen Payday", lineupSize: 9, hasSourceHandle, venueKeys: new Set() }).confidence;
    expect(classify(records.some((r) => r.entry === "SEID" && evidenceBacksAppearance(r)))).toBe("high");
    expect(classify(false)).toBe("review");
  });
});
