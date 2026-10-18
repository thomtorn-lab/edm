import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ShadowDecision } from "./ticketReplacementShadow";
import { evaluateShadowLabels, validateShadowLabels, type ShadowLabel } from "./ticketShadowEvaluation";

function decision(id: string, outcome: ShadowDecision["outcome"], withheldReason: ShadowDecision["withheldReason"] = null): ShadowDecision {
  return {
    decisionId: id,
    sourceId: id.split(":")[0],
    eventId: id.split(":")[1],
    eventTitle: "t",
    candidateTitle: "t",
    venueId: "v-culture-box",
    night: "2026-11-07",
    storedTicketUrl: "https://a.example",
    incomingTicketUrl: "https://b.example",
    outcome,
    withheldReason,
    identity: null,
    explanation: [],
  };
}

function label(id: string, outcome: ShadowLabel["outcome"], verdict: ShadowLabel["verdict"], withheld_reason: ShadowLabel["withheld_reason"] = null): ShadowLabel {
  return { decision_id: id, outcome, withheld_reason, verdict, labeled_by: "editor 2026-10-20", note: "checked both links and the source page" };
}

describe("validateShadowLabels", () => {
  it("the committed labels file is valid", () => {
    const file = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "qa", "ticket-shadow-labels.json"), "utf-8"));
    expect(validateShadowLabels(file)).toEqual([]);
  });

  it("rejects wrong schema version, duplicate ids, verdicts for the wrong outcome and empty notes", () => {
    const errors = validateShadowLabels({
      schema_version: 2,
      labels: [
        label("s:e1:1", "would_replace", "correct"),
        label("s:e1:1", "would_replace", "correct"),
        label("s:e2:1", "would_replace", "withheld_correct"),
        label("s:e3:1", "withheld", "correct", "room_conflict"),
        label("s:e4:1", "withheld", "withheld_correct", null),
        { ...label("s:e5:1", "would_replace", "correct"), note: " " },
      ],
    });
    expect(errors).toEqual([
      "schema_version must be 1",
      "labels[1]: duplicate decision_id s:e1:1",
      "labels[2]: verdict must be one of correct, wrong_event, wrong_link, unresolved",
      "labels[3]: verdict must be one of withheld_correct, replacement_would_be_correct, unresolved",
      "labels[4]: withheld_reason is required for withheld",
      "labels[5]: note must say what was checked",
    ]);
  });
});

describe("evaluateShadowLabels", () => {
  const decisions = [
    decision("src-culture-box:e1:aa", "would_replace"),
    decision("src-culture-box:e2:bb", "would_replace"),
    decision("src-culture-box:e3:cc", "would_replace"),
    decision("src-culture-box:e4:dd", "withheld", "ambiguous_match"),
    decision("src-culture-box:e5:ee", "withheld", "room_conflict"),
    decision("src-hangaren:e6:ff", "withheld", "insufficient_identity"),
    decision("src-culture-box:e7:gg", "confirm"),
  ];

  it("counts false positives, false negatives and precision", () => {
    const ev = evaluateShadowLabels(decisions, [
      label("src-culture-box:e1:aa", "would_replace", "correct"),
      label("src-culture-box:e2:bb", "would_replace", "wrong_link"),
      label("src-culture-box:e3:cc", "would_replace", "unresolved"),
      label("src-culture-box:e4:dd", "withheld", "replacement_would_be_correct", "ambiguous_match"),
      label("src-culture-box:e5:ee", "withheld", "withheld_correct", "room_conflict"),
    ]);
    expect(ev.wouldReplace).toEqual({ labeled: 3, correct: 1, falsePositives: 1, unresolved: 1, precision: 0.5 });
    expect(ev.withheld).toEqual({ labeled: 2, correct: 1, falseNegatives: 1, unresolved: 0 });
    expect(ev.falsePositiveIds).toEqual(["src-culture-box:e2:bb"]);
    expect(ev.falseNegativeIds).toEqual(["src-culture-box:e4:dd"]);
    expect(ev.falseNegativesByReason).toEqual({ ambiguous_match: 1 });
    expect(ev.coverageBySource).toEqual({ "src-culture-box": 5 });
    expect(ev.unlabeledIds).toEqual(["src-hangaren:e6:ff"]);
    expect(ev.evidenceChecklist[0]).toMatch(/any false positive blocks activation/);
  });

  it("never declares activation ready, even with zero false positives among 20 labeled cases", () => {
    const many = Array.from({ length: 20 }, (_, i) => decision(`src-culture-box:e${i}:${i}`, "would_replace"));
    const ev = evaluateShadowLabels(
      many,
      many.map((d) => label(d.decisionId, "would_replace", "correct")),
    );
    expect(ev.wouldReplace.falsePositives).toBe(0);
    expect(ev.wouldReplace.precision).toBe(1);
    expect(ev.activation).toBe("requires explicit human approval");
    expect(ev.evidenceChecklist.join("\n")).toMatch(/not sufficient/);
  });

  it("flags labels from another run and labels whose outcome changed since labeling", () => {
    const ev = evaluateShadowLabels(decisions, [
      label("src-culture-box:gone:00", "would_replace", "correct"),
      label("src-culture-box:e5:ee", "withheld", "withheld_correct", "ambiguous_match"),
    ]);
    expect(ev.unmatchedLabelIds).toEqual(["src-culture-box:gone:00"]);
    expect(ev.outcomeChangedIds).toEqual(["src-culture-box:e5:ee"]);
    expect(ev.labeled).toBe(0);
  });

  it("precision is n/a when nothing was decided", () => {
    expect(evaluateShadowLabels(decisions, []).wouldReplace.precision).toBeNull();
  });
});
