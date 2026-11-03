import { describe, expect, it } from "vitest";
import { buildSoundcloudEvidenceAuditSection } from "./evidenceAudit";

/** Synthetic rows shaped like the shared audit's loader output; names and handles from real events. */
const events = [
  { id: "e-cb1", canonicalSourceId: "src-culture-box", artists: ["LELE", "REXIE LEX"], description: null, officialEventUrl: null },
  { id: "e-cb2", canonicalSourceId: "src-culture-box", artists: ["LeLe"], description: null, officialEventUrl: null },
  {
    id: "e-pyl",
    canonicalSourceId: "src-pylonen",
    artists: ["SEID", "Natq"],
    description: "SEID (Frikvens Syndikatet) https://soundcloud.com/seid1312",
    officialEventUrl: null,
  },
  {
    id: "e-adm",
    canonicalSourceId: null,
    artists: ["Rexie Lex", "NAT b2b YOON", "Lulla-Li & Nihility", "Kromagon"],
    description: "Lulla-Li & Nihility: https://soundcloud.com/tenna-li-andersen\nKromagon: https://soundcloud.com/aragon",
    officialEventUrl: null,
  },
];
const links = [
  { eventId: "e-cb1", artistName: "LELE", url: "https://soundcloud.com/user-442274348" },
  { eventId: "e-cb1", artistName: "REXIE LEX", url: "https://soundcloud.com/rexie_lex" },
  { eventId: "e-cb2", artistName: "LeLe", url: "https://soundcloud.com/user-339333395" },
];

describe("buildSoundcloudEvidenceAuditSection", () => {
  const section = buildSoundcloudEvidenceAuditSection({ events, links, blockedUrls: [] });
  const of = (id: string) => section.bySource.find((s) => s.sourceId === id)!;

  it("counts what is shown today, what the stored text documents, and what reuse would cover, per source", () => {
    expect(of("src-culture-box")).toMatchObject({ events: 2, performers: 3, shownToday: 3, documentedNotCaptured: 0 });
    expect(of("src-pylonen")).toMatchObject({ performers: 2, shownToday: 0, documentedNotCaptured: 1, reusableByKey: 0, none: 1 });
    // admin: Rexie Lex reusable from Culture Box; NAT b2b YOON splits into two performers with no evidence; the duo's link is conflicted
    // Kromagon's admin text link is a candidate only (admin_inline), never "documented by the source"
    expect(of("(admin)")).toMatchObject({ performers: 5, documentedNotCaptured: 0, adminCandidates: 1, reusableByKey: 1, conflicted: 1, none: 2 });
  });

  it("lists LELE/LeLe as one key with two profiles", () => {
    expect(section.keysWithSeveralProfiles).toEqual([
      { key: "lele", urls: ["https://soundcloud.com/user-339333395", "https://soundcloud.com/user-442274348"], entries: ["LELE", "LeLe"] },
    ]);
  });

  it("a blocked profile is never counted as shown, nor reused", () => {
    const withBlock = buildSoundcloudEvidenceAuditSection({ events, links, blockedUrls: ["https://soundcloud.com/rexie_lex"] });
    expect(withBlock.blockedLinks).toBe(1);
    expect(withBlock.bySource.find((s) => s.sourceId === "src-culture-box")!.shownToday).toBe(2);
    expect(withBlock.bySource.find((s) => s.sourceId === "(admin)")!.reusableByKey).toBe(0);
  });

  it("declares its bases like the shared audit", () => {
    expect(section.basis).toEqual({ shownToday: "observed", documentedNotCaptured: "observed", adminCandidates: "observed", reusableByKey: "estimated", conflicted: "observed" });
  });
});
