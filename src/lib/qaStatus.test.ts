import { describe, expect, it } from "vitest";
import { reconcileQaStatus, validateQaStatus, type QaStatus } from "./qaStatus";
const empty: QaStatus = { schema_version: 1, generation: 0, snapshot_generated_at: null,
  last_successful_run_at: null, checks: [], reported_issues: [] };
describe("QA status continuity", () => {
  it("adds pending checks and preserves them on a second run", () => {
    const items = [{ subject_id: "event-1", category: "music_genre" as const, source_fingerprint: "a" }];
    const first = reconcileQaStatus(empty, items, "2026-10-29T10:00:00Z");
    expect(first.checks[0].status).toBe("pending");
    first.checks[0].status = "completed";
    first.checks[0].checked_at = "2026-10-29T10:01:00Z";
    const second = reconcileQaStatus(first, items, "2026-10-30T10:00:00Z");
    expect(second.checks[0].status).toBe("completed");
    expect(second.generation).toBe(2);
  });
  it("reopens a completed check when source changes", () => {
    const first = reconcileQaStatus(empty, [{ subject_id: "event-1", category: "source_facts", source_fingerprint: "a" }], "2026-10-29T10:00:00Z");
    first.checks[0].status = "completed";
    const next = reconcileQaStatus(first, [{ subject_id: "event-1", category: "source_facts", source_fingerprint: "b" }], "2026-10-30T10:00:00Z");
    expect(next.checks[0].status).toBe("pending");
  });
  it("rejects duplicate check keys", () => {
    const one = reconcileQaStatus(empty, [{ subject_id: "event-1", category: "links", source_fingerprint: null }], "2026-10-29T10:00:00Z");
    expect(() => validateQaStatus({ ...one, checks: [one.checks[0], one.checks[0]] })).toThrow();
  });
});
