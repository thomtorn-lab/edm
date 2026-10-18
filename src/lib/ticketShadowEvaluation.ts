/**
 * Manual QA labels and evaluation for the ticket-replacement shadow report
 * (thomtorn-lab/edm#145, 2026-10-18). Pure functions: the labels live in a
 * versioned file (qa/ticket-shadow-labels.json) an editor fills in from a
 * report's labelTemplate, and evaluateShadowLabels measures false positives
 * and false negatives against them.
 *
 * Deliberately never returns "ready to activate": metrics are evidence for a
 * human decision, and a clean small sample (e.g. 0 false positives among 20
 * labeled cases) is not on its own sufficient for Production activation.
 */
import type { ShadowDecision, WithheldReason } from "./ticketReplacementShadow";

export const SHADOW_LABELS_SCHEMA_VERSION = 1;

/** Verdicts for an outcome of would_replace. */
export const REPLACE_VERDICTS = ["correct", "wrong_event", "wrong_link", "unresolved"] as const;
/** Verdicts for an outcome of withheld. */
export const WITHHELD_VERDICTS = ["withheld_correct", "replacement_would_be_correct", "unresolved"] as const;

export type ReplaceVerdict = (typeof REPLACE_VERDICTS)[number];
export type WithheldVerdict = (typeof WITHHELD_VERDICTS)[number];

export interface ShadowLabel {
  decision_id: string;
  outcome: "would_replace" | "withheld";
  withheld_reason: WithheldReason | null;
  verdict: ReplaceVerdict | WithheldVerdict;
  /** Who labeled it and when (free text, e.g. "editor 2026-10-20"). */
  labeled_by: string;
  /** What was checked: both links, the source page, the stored event. */
  note: string;
}

export interface ShadowLabelsFile {
  schema_version: number;
  labels: ShadowLabel[];
}

/** Returns every problem found; an empty array means the file is valid. */
export function validateShadowLabels(file: unknown): string[] {
  const errors: string[] = [];
  if (typeof file !== "object" || file === null) return ["labels file must be an object"];
  const f = file as Partial<ShadowLabelsFile>;
  if (f.schema_version !== SHADOW_LABELS_SCHEMA_VERSION) errors.push(`schema_version must be ${SHADOW_LABELS_SCHEMA_VERSION}`);
  if (!Array.isArray(f.labels)) return [...errors, "labels must be an array"];
  const seen = new Set<string>();
  f.labels.forEach((l, i) => {
    const at = `labels[${i}]`;
    if (typeof l?.decision_id !== "string" || l.decision_id.length === 0) {
      errors.push(`${at}: decision_id is required`);
    } else if (seen.has(l.decision_id)) {
      errors.push(`${at}: duplicate decision_id ${l.decision_id}`);
    } else {
      seen.add(l.decision_id);
    }
    if (l?.outcome === "would_replace") {
      if (!(REPLACE_VERDICTS as readonly string[]).includes(l.verdict)) errors.push(`${at}: verdict must be one of ${REPLACE_VERDICTS.join(", ")}`);
      if (l.withheld_reason !== null) errors.push(`${at}: withheld_reason must be null for would_replace`);
    } else if (l?.outcome === "withheld") {
      if (!(WITHHELD_VERDICTS as readonly string[]).includes(l.verdict)) errors.push(`${at}: verdict must be one of ${WITHHELD_VERDICTS.join(", ")}`);
      if (typeof l.withheld_reason !== "string") errors.push(`${at}: withheld_reason is required for withheld`);
    } else {
      errors.push(`${at}: outcome must be would_replace or withheld`);
    }
    if (typeof l?.labeled_by !== "string" || l.labeled_by.trim() === "") errors.push(`${at}: labeled_by is required`);
    if (typeof l?.note !== "string" || l.note.trim() === "") errors.push(`${at}: note must say what was checked`);
  });
  return errors;
}

export interface ShadowEvaluation {
  labeled: number;
  wouldReplace: { labeled: number; correct: number; falsePositives: number; unresolved: number; precision: number | null };
  withheld: { labeled: number; correct: number; falseNegatives: number; unresolved: number };
  falsePositiveIds: string[];
  falseNegativeIds: string[];
  /** False negatives per withheld reason: which rule is too strict. */
  falseNegativesByReason: Partial<Record<WithheldReason, number>>;
  /** Labeled decisions per source and per withheld reason (coverage). */
  coverageBySource: Record<string, number>;
  coverageByReason: Partial<Record<WithheldReason, number>>;
  /** Labels whose decision is not in the report (stale or from another run). */
  unmatchedLabelIds: string[];
  /** Labels whose recorded outcome no longer matches the report's (rule changed). */
  outcomeChangedIds: string[];
  /** Report decisions that still need a label. */
  unlabeledIds: string[];
  /** What the evidence does and does not show; never a go decision. */
  evidenceChecklist: string[];
  activation: "requires explicit human approval";
}

function sourceOf(decisionId: string): string {
  return decisionId.split(":")[0] ?? "unknown";
}

export function evaluateShadowLabels(decisions: ShadowDecision[], labels: ShadowLabel[]): ShadowEvaluation {
  const byId = new Map(decisions.map((d) => [d.decisionId, d]));
  const labeledIds = new Set(labels.map((l) => l.decision_id));
  const unmatchedLabelIds: string[] = [];
  const outcomeChangedIds: string[] = [];
  const falsePositiveIds: string[] = [];
  const falseNegativeIds: string[] = [];
  const falseNegativesByReason: Partial<Record<WithheldReason, number>> = {};
  const coverageBySource: Record<string, number> = {};
  const coverageByReason: Partial<Record<WithheldReason, number>> = {};
  const wr = { labeled: 0, correct: 0, falsePositives: 0, unresolved: 0, precision: null as number | null };
  const wh = { labeled: 0, correct: 0, falseNegatives: 0, unresolved: 0 };

  for (const label of labels) {
    const decision = byId.get(label.decision_id);
    if (!decision) {
      unmatchedLabelIds.push(label.decision_id);
      continue;
    }
    if (decision.outcome !== label.outcome || decision.withheldReason !== label.withheld_reason) {
      outcomeChangedIds.push(label.decision_id);
      continue;
    }
    coverageBySource[sourceOf(label.decision_id)] = (coverageBySource[sourceOf(label.decision_id)] ?? 0) + 1;
    if (label.outcome === "would_replace") {
      wr.labeled++;
      if (label.verdict === "correct") wr.correct++;
      else if (label.verdict === "wrong_event" || label.verdict === "wrong_link") {
        wr.falsePositives++;
        falsePositiveIds.push(label.decision_id);
      } else wr.unresolved++;
    } else {
      const reason = label.withheld_reason as WithheldReason;
      coverageByReason[reason] = (coverageByReason[reason] ?? 0) + 1;
      wh.labeled++;
      if (label.verdict === "withheld_correct") wh.correct++;
      else if (label.verdict === "replacement_would_be_correct") {
        wh.falseNegatives++;
        falseNegativeIds.push(label.decision_id);
        falseNegativesByReason[reason] = (falseNegativesByReason[reason] ?? 0) + 1;
      } else wh.unresolved++;
    }
  }
  const decided = wr.correct + wr.falsePositives;
  wr.precision = decided > 0 ? wr.correct / decided : null;

  const unlabeledIds = decisions
    .filter((d) => (d.outcome === "would_replace" || d.outcome === "withheld") && !labeledIds.has(d.decisionId))
    .map((d) => d.decisionId);

  const checklist: string[] = [
    `false positives among labeled would_replace: ${wr.falsePositives} of ${wr.labeled}${wr.falsePositives > 0 ? " — any false positive blocks activation" : ""}`,
    `precision (correct / (correct + wrong)): ${wr.precision === null ? "n/a (nothing decided)" : wr.precision.toFixed(3)}; unresolved labels are excluded and must be resolved`,
    `false negatives among labeled withheld: ${wh.falseNegatives} of ${wh.labeled} (rules that are too strict; not blocking)`,
    `labeled decisions per source: ${JSON.stringify(coverageBySource)}; every source to be activated needs its own labeled would_replace cases`,
    `withheld reasons covered by labels: ${Object.keys(coverageByReason).length}; each reason seen in reports should have labeled examples`,
    `unlabeled would_replace/withheld decisions in this report: ${unlabeledIds.length}`,
    "a small clean sample is not sufficient: zero false positives among 20 labeled cases is still compatible with a true false-positive rate of about 14% (exact one-sided 95% upper bound; rule of three: 3/20 = 15%)",
    "activation also needs: several reports over time, every edge case (shared ticket pages, moved events, two shows the same evening, competing matches) represented, and the labeled cases kept as regression fixtures",
  ];
  if (unmatchedLabelIds.length > 0) checklist.push(`labels not found in this report: ${unmatchedLabelIds.length} (from another run or source)`);
  if (outcomeChangedIds.length > 0) checklist.push(`labels whose outcome changed since labeling: ${outcomeChangedIds.length} — relabel before relying on them`);

  return {
    labeled: wr.labeled + wh.labeled,
    wouldReplace: wr,
    withheld: wh,
    falsePositiveIds,
    falseNegativeIds,
    falseNegativesByReason,
    coverageBySource,
    coverageByReason,
    unmatchedLabelIds,
    outcomeChangedIds,
    unlabeledIds,
    evidenceChecklist: checklist,
    activation: "requires explicit human approval",
  };
}
