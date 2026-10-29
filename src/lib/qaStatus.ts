/**
 * Versioned QA checkpoint. No DB writes. The caller persists via GitHub
 * Contents API with the blob SHA from the immediately preceding read.
 */
export const QA_CATEGORIES = [
  "source_facts", "music_genre", "links", "duplicates", "discovery",
  "about_language", "production_technical"
] as const;
export type QaCategory = typeof QA_CATEGORIES[number];
export type QaCheck = {
  subject_id: string;
  category: QaCategory;
  status: "pending" | "completed" | "blocked";
  source_fingerprint: string | null;
  checked_at: string | null;
  next_check_at: string | null;
  evidence: string[];
  reported_issue_ids: string[];
};
export type QaStatus = {
  schema_version: 1;
  generation: number;
  snapshot_generated_at: string | null;
  last_successful_run_at: string | null;
  checks: QaCheck[];
  reported_issues: { id: string; subject_id: string; category: QaCategory; reported_at: string; resolved_at: string | null }[];
};
export function validateQaStatus(value: unknown): asserts value is QaStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid QA status");
  const x = value as Partial<QaStatus>;
  if (x.schema_version !== 1 || !Number.isSafeInteger(x.generation) || (x.generation ?? -1) < 0 ||
    !Array.isArray(x.checks) || !Array.isArray(x.reported_issues)) throw new Error("Invalid QA status schema");
  const keys = new Set<string>();
  for (const c of x.checks) {
    if (!c || typeof c.subject_id !== "string" || !QA_CATEGORIES.includes(c.category) ||
      !["pending", "completed", "blocked"].includes(c.status) ||
      !Array.isArray(c.evidence) || !Array.isArray(c.reported_issue_ids)) throw new Error("Invalid QA check");
    const key = c.subject_id + ":" + c.category;
    if (keys.has(key)) throw new Error("Duplicate QA check: " + key);
    keys.add(key);
  }
}
export function reconcileQaStatus(previous: QaStatus, incoming: {
  subject_id: string; category: QaCategory; source_fingerprint: string | null
}[], snapshotAt: string): QaStatus {
  validateQaStatus(previous);
  const byKey = new Map(previous.checks.map(c => [c.subject_id + ":" + c.category, c]));
  for (const item of incoming) {
    const key = item.subject_id + ":" + item.category;
    const old = byKey.get(key);
    if (!old) {
      byKey.set(key, { ...item, status: "pending", checked_at: null, next_check_at: null,
        evidence: [], reported_issue_ids: [] });
    } else if (old.source_fingerprint !== item.source_fingerprint) {
      byKey.set(key, { ...old, status: "pending", source_fingerprint: item.source_fingerprint,
        next_check_at: snapshotAt });
    }
  }
  // Retain previous checks and issues for audit/history, even when events expire.
  return { ...previous, generation: previous.generation + 1,
    snapshot_generated_at: snapshotAt, checks: [...byKey.values()] };
}
