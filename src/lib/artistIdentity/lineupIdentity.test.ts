import { describe, expect, it } from "vitest";
import {
  artistIdentityKey,
  classifyAppearance,
  splitLineupEntry,
  weakSeparatorParts,
  type AppearanceInput,
} from "./lineupIdentity";

const NO_VENUES = new Set<string>();

function appearance(entry: string, overrides: Partial<AppearanceInput> = {}) {
  const lineupSize = overrides.lineupSize ?? 3;
  const [part] = splitLineupEntry(entry);
  return classifyAppearance({
    entry,
    part,
    eventTitle: "Some Night",
    lineupSize,
    hasSourceHandle: false,
    venueKeys: NO_VENUES,
    ...overrides,
  });
}

describe("splitLineupEntry", () => {
  it("splits B2B-style entries into individually followable performers", () => {
    expect(splitLineupEntry("KRÆ B2B KIRAKINGKONG").map((p) => p.name)).toEqual(["KRÆ", "KIRAKINGKONG"]);
    expect(splitLineupEntry("Aja Gulris b2b Nayz").map((p) => p.name)).toEqual(["Aja Gulris", "Nayz"]);
    expect(splitLineupEntry("A b3b B b3b C").map((p) => p.name)).toEqual(["A", "B", "C"]);
    expect(splitLineupEntry("Ivan Ibarra back to back Sheik").every((p) => p.fromB2bSplit)).toBe(true);
  });

  it("never splits on &, x, + or commas (duo names use them)", () => {
    for (const name of ["Chase & Status", "Above & Beyond", "Camo & Krooked", "CRINGE x MY LITTLE PARTY", "AB+", "Jamie xx"]) {
      expect(splitLineupEntry(name)).toEqual([{ name, fromB2bSplit: false }]);
    }
  });

  it("does not treat b2b inside a word as a separator", () => {
    expect(splitLineupEntry("Ab2bc")).toHaveLength(1);
  });
});

describe("artistIdentityKey", () => {
  it("drops trailing label brackets of either kind (normalizeArtistName alone keeps [..])", () => {
    expect(artistIdentityKey("Damian Lazarus [Crosstown Rebels]")).toBe("damian lazarus");
    expect(artistIdentityKey("Gerd Janson (Running Back)")).toBe("gerd janson");
    expect(artistIdentityKey("Âme (live) (Innervisions)")).toBe(artistIdentityKey("Âme"));
  });

  it("drops a country code only when the shared classification calls it cleanable", () => {
    expect(artistIdentityKey("Mike Sheridan DK")).toBe("mike sheridan");
    expect(artistIdentityKey("Lido Pimienta CA/CO")).toBe("lido pimienta");
    expect(artistIdentityKey("JAMIE XX")).toBe("jamie xx");
  });

  it("drops a status tail but keeps the name", () => {
    expect(artistIdentityKey("Dengue Dengue Dengue PE – NEW DATE")).toBe("dengue dengue dengue");
  });

  it("joins case variants but keeps distinct spellings apart", () => {
    expect(artistIdentityKey("ELLIOTT TAGUCHI")).toBe(artistIdentityKey("Elliott Taguchi"));
    expect(artistIdentityKey("Benji B")).not.toBe(artistIdentityKey("Benji"));
  });
});

describe("classifyAppearance", () => {
  it("excludes non-artists and venue names", () => {
    expect(appearance("TBA").bucket).toBe("not_artist");
    expect(appearance("Special Guest").bucket).toBe("not_artist");
    expect(appearance("Karrusel 2027").bucket).toBe("not_artist");
    expect(appearance("Culture Box", { venueKeys: new Set(["culture box"]) }).bucket).toBe("venue_name");
  });

  it("a source's own SoundCloud link makes even a short name high confidence", () => {
    const result = appearance("NAT", { hasSourceHandle: true });
    expect(result.bucket).toBe("handle");
    expect(result.confidence).toBe("high");
  });

  it("short names without a handle go to review", () => {
    for (const name of ["NAT", "CERJ", "ENNA", "SHDW [Mutual Rytm]"]) {
      expect(appearance(name).confidence).toBe("review");
    }
  });

  it("event words and label shapes go to review", () => {
    expect(appearance("Fagins Reject – Wild Things Records").bucket).toBe("event_marker");
    expect(appearance("ALICE TUNES IN: Danske Kvalmer DK").bucket).toBe("event_marker");
  });

  it("possible multi-act entries go to review, never split", () => {
    const result = appearance("Kevin de Vries & Massano");
    expect(result.bucket).toBe("weak_split");
    expect(weakSeparatorParts("Kevin de Vries & Massano")).toEqual(["Kevin de Vries", "Massano"]);
  });

  it("separates a title stored as the artist from a normal billing", () => {
    const series = appearance("Protoned Christmas Rave", { eventTitle: "Protoned Christmas Rave", lineupSize: 1 });
    expect(series.bucket).toBe("title_copy_marker");
    const headliner = appearance("ERIC PRYDZ", { eventTitle: "ERIC PRYDZ", lineupSize: 1 });
    expect(headliner.bucket).toBe("title_copy");
    expect(headliner.confidence).toBe("pending_decision");
    expect(appearance("ERIC PRYDZ", { eventTitle: "ERIC PRYDZ", lineupSize: 2 }).bucket).toBe("distinct");
  });

  it("keeps protected duo and stylised names followable", () => {
    for (const name of ["Above & Beyond", "Chase & Status"]) {
      expect(appearance(name).confidence).not.toBe("excluded");
    }
    for (const name of ["Fred again..", "2manydjs", "Vini Vici", "Kasper Bjørke"]) {
      expect(appearance(name).bucket).toBe("distinct");
    }
  });
});

describe("evidenceBacksAppearance", () => {
  const base = {
    kind: "soundcloud_profile" as const,
    entry: "NAT",
    key: "nat",
    url: "https://soundcloud.com/nat",
    signal: "source_anchor" as const,
    sourceId: "src-culture-box",
    eventId: "e-1",
    sourceUrl: null,
    observedAt: new Date("2026-10-24T00:00:00Z"),
    conflict: null,
  };

  it("accepts only conflict-free source evidence tied to an event", async () => {
    const { evidenceBacksAppearance } = await import("./evidence");
    expect(evidenceBacksAppearance(base)).toBe(true);
    expect(evidenceBacksAppearance({ ...base, signal: "source_inline" })).toBe(true);
    expect(evidenceBacksAppearance({ ...base, signal: "ra_chain" })).toBe(false);
    expect(evidenceBacksAppearance({ ...base, signal: "discogs_url" })).toBe(false);
    expect(evidenceBacksAppearance({ ...base, eventId: null })).toBe(false);
    expect(evidenceBacksAppearance({ ...base, conflict: { kind: "two_handles_same_key", otherUrls: ["https://soundcloud.com/other"] } })).toBe(false);
  });
});
