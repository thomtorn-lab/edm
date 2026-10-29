/** Persistent QA ledger. Only a verified GitHub blob-SHA compare-and-swap may save it. */
import { createHash } from "node:crypto";
export const QA_CATEGORIES = ["source_facts","music_genre","links","duplicates","discovery","about_language","production_technical"] as const;
export type QaCategory = typeof QA_CATEGORIES[number];
export type QaCheck = {
  subject_id: string; category: QaCategory; status: "pending"|"completed"|"blocked";
  source_fingerprint: string|null; checked_at: string|null; next_check_at: string|null;
  evidence: string[]; reported_issue_ids: string[];
};
export type QaIssue = { id:string; subject_id:string; category:QaCategory; reported_at:string; resolved_at:string|null };
export type QaStatus = {
  schema_version:1; generation:number; snapshot_generated_at:string|null;
  last_successful_run_at:string|null; checks:QaCheck[]; reported_issues:QaIssue[];
};
export type QaInput = {subject_id:string;category:QaCategory;source_fingerprint:string|null};
const isDate = (x: unknown) => x === null || (typeof x === "string" && Number.isFinite(Date.parse(x)));
export function validateQaStatus(value:unknown): asserts value is QaStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid QA status");
  const s = value as QaStatus;
  if (s.schema_version !== 1 || !Number.isSafeInteger(s.generation) || s.generation < 0 ||
      !isDate(s.snapshot_generated_at) || !isDate(s.last_successful_run_at) ||
      !Array.isArray(s.checks) || !Array.isArray(s.reported_issues)) throw new Error("Invalid QA status schema");
  const keys = new Set<string>();
  for (const c of s.checks) {
    if (!c || typeof c.subject_id !== "string" || !c.subject_id ||
      !QA_CATEGORIES.includes(c.category) || !["pending","completed","blocked"].includes(c.status) ||
      !(c.source_fingerprint === null || typeof c.source_fingerprint === "string") ||
      !isDate(c.checked_at) || !isDate(c.next_check_at) ||
      !Array.isArray(c.evidence) || !c.evidence.every(x=>typeof x==="string") ||
      !Array.isArray(c.reported_issue_ids) || !c.reported_issue_ids.every(x=>typeof x==="string"))
      throw new Error("Invalid QA check");
    const k = JSON.stringify([c.subject_id,c.category]);
    if (keys.has(k)) throw new Error("Duplicate QA check: "+k);
    keys.add(k);
  }
  const issueIds = new Set<string>();
  for (const i of s.reported_issues) {
    if (!i || typeof i.id !== "string" || !i.id || typeof i.subject_id !== "string" ||
      !QA_CATEGORIES.includes(i.category) || !isDate(i.reported_at) || i.reported_at===null ||
      !isDate(i.resolved_at) || issueIds.has(i.id)) throw new Error("Invalid/duplicate issue");
    issueIds.add(i.id);
  }
}
function stable(value:unknown):unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value==="object") return Object.fromEntries(
    Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
      .map(([k,v])=>[k,stable(v)]));
  return value;
}
export function fingerprint(value:unknown):string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
export function reconcileQaStatus(previous:QaStatus,incoming:QaInput[],snapshotAt:string):QaStatus {
  validateQaStatus(previous);
  if (!isDate(snapshotAt) || !snapshotAt) throw new Error("Invalid snapshot timestamp");
  if (previous.snapshot_generated_at && Date.parse(snapshotAt)<Date.parse(previous.snapshot_generated_at))
    throw new Error("Stale snapshot: refusing to roll QA status backwards");
  const map = new Map(previous.checks.map(c=>[JSON.stringify([c.subject_id,c.category]),{...c}]));
  const seen = new Set<string>();
  for (const item of incoming) {
    if (!QA_CATEGORIES.includes(item.category) || !item.subject_id) throw new Error("Invalid incoming check");
    const k=JSON.stringify([item.subject_id,item.category]);
    if (seen.has(k)) throw new Error("Duplicate incoming check: "+k);
    seen.add(k);
    const old=map.get(k);
    if (!old) map.set(k,{...item,status:"pending",checked_at:null,next_check_at:null,evidence:[],reported_issue_ids:[]});
    else if (old.source_fingerprint!==item.source_fingerprint ||
      (old.next_check_at!==null && Date.parse(old.next_check_at)<=Date.parse(snapshotAt))) {
      map.set(k,{...old,source_fingerprint:item.source_fingerprint,status:"pending",checked_at:null,
        next_check_at:null,evidence:[],reported_issue_ids:[...old.reported_issue_ids]});
    }
  }
  // Missing subjects are retained, never silently marked complete or removed.
  return {...previous,generation:previous.generation+1,snapshot_generated_at:snapshotAt,checks:[...map.values()]};
}
/** Changes must be based on the blob SHA just fetched; never force-push or auto-retry conflicts. */
export async function persistQaStatus(
  read:()=>Promise<{sha:string;content:string}>,
  write:(sha:string,content:string)=>Promise<void>,
  prepare:(current:QaStatus)=>QaStatus
):Promise<QaStatus> {
  const fetched=await read();
  if (!fetched.sha || !/^[a-f0-9]{40}$/.test(fetched.sha)) throw new Error("Missing GitHub blob SHA");
  const previous:unknown=JSON.parse(fetched.content);
  validateQaStatus(previous);
  const next=prepare(previous);
  validateQaStatus(next);
  if (next.generation!==previous.generation+1) throw new Error("Generation must advance by one");
  await write(fetched.sha,JSON.stringify(next,null,2)+"\n");
  const verified=await read();
  const reread:unknown=JSON.parse(verified.content);
  validateQaStatus(reread);
  if (fingerprint(reread)!==fingerprint(next)) throw new Error("GitHub write verification failed");
  return reread;
}
