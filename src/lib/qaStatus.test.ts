import { describe, expect, it } from "vitest";
import { reconcileQaStatus, validateQaStatus, persistQaStatus, fingerprint, type QaStatus } from "./qaStatus";
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
  it("does not reopen unchanged check before deadline, but reopens at deadline", () => {
    const input = [{subject_id:"e",category:"links" as const,source_fingerprint:"x"}];
    const a=reconcileQaStatus(empty,input,"2026-10-29T04:00:00Z");
    a.checks[0].status="completed";a.checks[0].checked_at="2026-10-29T04:00:00Z";
    a.checks[0].next_check_at="2026-10-31T04:00:00Z";
    const b=reconcileQaStatus(a,input,"2026-10-30T04:00:00Z");
    expect(b.checks[0].status).toBe("completed");
    const c=reconcileQaStatus(b,input,"2026-10-31T04:00:00Z");
    expect(c.checks[0].status).toBe("pending");
  });
  it("rejects stale snapshots and duplicate incoming checks", () => {
    const a=reconcileQaStatus(empty,[],"2026-10-30T04:00:00Z");
    expect(()=>reconcileQaStatus(a,[],"2026-10-29T04:00:00Z")).toThrow(/Stale/);
    const input={subject_id:"e",category:"links" as const,source_fingerprint:"x"};
    expect(()=>reconcileQaStatus(empty,[input,input],"2026-10-30T04:00:00Z")).toThrow(/Duplicate/);
  });
  it("preserves issue history across changes", () => {
    const a=reconcileQaStatus({...empty,reported_issues:[{id:"issue-1",subject_id:"e",category:"links",reported_at:"2026-10-29T04:00:00Z",resolved_at:null}]},
      [{subject_id:"e",category:"links",source_fingerprint:"x"}],"2026-10-29T04:00:00Z");
    a.checks[0].reported_issue_ids=["issue-1"];
    const b=reconcileQaStatus(a,[{subject_id:"e",category:"links",source_fingerprint:"y"}],"2026-10-30T04:00:00Z");
    expect(b.reported_issues).toEqual(a.reported_issues);
    expect(b.checks[0].reported_issue_ids).toEqual(["issue-1"]);
  });
  it("fingerprint is independent of object key order",()=>{
    expect(fingerprint({a:1,b:2})).toBe(fingerprint({b:2,a:1}));
  });
  it("does not write if GitHub read fails",async()=>{
    let writes=0;
    await expect(persistQaStatus(async()=>{throw Error("access denied")},async()=>{writes++},x=>x)).rejects.toThrow(/access denied/);
    expect(writes).toBe(0);
  });
  it("stops on a SHA conflict without blind retries",async()=>{
    let writes=0;
    const read=async()=>({sha:"a".repeat(40),content:JSON.stringify(empty)});
    await expect(persistQaStatus(read,async()=>{writes++;throw Error("409 conflict")},x=>({...x,generation:x.generation+1}))).rejects.toThrow(/409/);
    expect(writes).toBe(1);
  });
  it("detects interrupted or unverifiable writes",async()=>{
    const read=async()=>({sha:"a".repeat(40),content:JSON.stringify(empty)});
    await expect(persistQaStatus(read,async()=>{},x=>({...x,generation:x.generation+1}))).rejects.toThrow(/verification failed/);
  });
});
