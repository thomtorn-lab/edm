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


describe("end-to-end synthetic QA ledger with SHA compare-and-swap",()=>{
  const at=(day:number)=>`2026-10-${String(day).padStart(2,"0")}T10:00:00Z`;
  const sha=(n:number)=>n.toString(16).padStart(40,"0");
  function fakeGithub(initial:QaStatus) {
    let file=JSON.stringify(initial),version=1,writes=0;
    let denyRead=false,failWrite=false,interrupt=false;
    return {
      read:async()=>{if(denyRead)throw Error("403 denied");return {sha:sha(version),content:file};},
      write:async(expected:string,content:string)=>{
        writes++;
        if(failWrite)throw Error("409 conflict");
        if(expected!==sha(version))throw Error("409 stale SHA");
        if(interrupt)return;
        file=content;version++;
      },
      get state(){return JSON.parse(file) as QaStatus;},
      get writes(){return writes;},
      deny:()=>{denyRead=true;},
      conflict:()=>{failWrite=true;},
      interrupted:()=>{interrupt=true;},
      corrupt:()=>{file="{invalid-json";},
      simulateConcurrentChange:()=>{version++;}
    };
  }
  it("reconciles, writes with SHA, rereads and resumes across 3 synthetic generations",async()=>{
    const github=fakeGithub(empty);
    const inputs=[
      {subject_id:"synthetic-e1",category:"music_genre" as const,source_fingerprint:"genre-A"},
      {subject_id:"synthetic-e1",category:"links" as const,source_fingerprint:"links-A"}
    ];
    const first=await persistQaStatus(github.read,github.write,x=>reconcileQaStatus(x,inputs,at(29)));
    expect(first.generation).toBe(1);
    expect(first.checks.every(x=>x.status==="pending")).toBe(true);
    // Synthetic human verification checkpoint; no production records.
    const verified:QaStatus={...first,generation:2,checks:first.checks.map(c=>({
      ...c,status:"completed" as const,checked_at:at(29),
      next_check_at:c.category==="links"?at(30):"2026-11-02T10:00:00Z",
      evidence:["synthetic evidence"],
      reported_issue_ids:c.category==="music_genre"?["synthetic-issue-1"]:[]
    })),reported_issues:[{id:"synthetic-issue-1",subject_id:"synthetic-e1",
      category:"music_genre",reported_at:at(29),resolved_at:null}]};
    await persistQaStatus(github.read,github.write,()=>verified);
    const expired=await persistQaStatus(github.read,github.write,x=>reconcileQaStatus(x,inputs,at(30)));
    expect(expired.generation).toBe(3);
    expect(expired.checks.find(x=>x.category==="links")?.status).toBe("pending");
    expect(expired.checks.find(x=>x.category==="music_genre")?.status).toBe("completed");
    const changed=await persistQaStatus(github.read,github.write,x=>reconcileQaStatus(x,[
      {...inputs[0],source_fingerprint:"genre-B"},inputs[1]],at(31)));
    expect(changed.generation).toBe(4);
    expect(changed.checks.find(x=>x.category==="music_genre")?.status).toBe("pending");
    expect(changed.checks.find(x=>x.category==="links")?.source_fingerprint).toBe("links-A");
    expect(changed.reported_issues).toEqual(verified.reported_issues);
    expect(changed.checks.find(x=>x.category==="music_genre")?.reported_issue_ids).toEqual(["synthetic-issue-1"]);
    expect(github.state).toEqual(changed);
    expect(github.writes).toBe(4);
  });
  it("stops on access denial without writing",async()=>{
    const gh=fakeGithub(empty);gh.deny();
    await expect(persistQaStatus(gh.read,gh.write,x=>reconcileQaStatus(x,[],at(29)))).rejects.toThrow(/403/);
    expect(gh.writes).toBe(0);
  });
  it("rejects corrupt JSON without writing",async()=>{
    const gh=fakeGithub(empty);gh.corrupt();
    await expect(persistQaStatus(gh.read,gh.write,x=>reconcileQaStatus(x,[],at(29)))).rejects.toThrow();
    expect(gh.writes).toBe(0);
  });
  it("rejects stale snapshot without writing or losing history",async()=>{
    const original=reconcileQaStatus(empty,[],at(30));
    const gh=fakeGithub(original);
    await expect(persistQaStatus(gh.read,gh.write,x=>reconcileQaStatus(x,[],at(29)))).rejects.toThrow(/Stale/);
    expect(gh.writes).toBe(0);expect(gh.state).toEqual(original);
  });
  it("rejects concurrent SHA changes without overwriting",async()=>{
    const gh=fakeGithub(empty);gh.simulateConcurrentChange();
    const stale=sha(1);
    await expect(gh.write(stale,JSON.stringify({...empty,generation:1}))).rejects.toThrow(/409/);
    expect(gh.state).toEqual(empty);
  });
  it("rejects 409 conflict and interrupted write, preserves original state",async()=>{
    const gh=fakeGithub(empty);gh.conflict();
    await expect(persistQaStatus(gh.read,gh.write,x=>reconcileQaStatus(x,[],at(29)))).rejects.toThrow(/409/);
    expect(gh.state).toEqual(empty);
    const interrupted=fakeGithub(empty);interrupted.interrupted();
    await expect(persistQaStatus(interrupted.read,interrupted.write,x=>reconcileQaStatus(x,[],at(29)))).rejects.toThrow(/verification failed/);
    expect(interrupted.state).toEqual(empty);
  });
});
