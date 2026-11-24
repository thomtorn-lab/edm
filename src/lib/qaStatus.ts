/**
 * Persistent QA control register for the owner's external ChatGPT QA (2026-11-24).
 *
 * Reused from the tested ledger on feature/qa-export-status-v1-20261029
 * (validateQaStatus, fingerprint, reconcileQaStatus), extended with result
 * files. Pure functions only: no database, network or editorial judgement.
 *
 * Writers:
 * - qa-status.json is written ONLY by .github/workflows/qa-export-readonly.yml
 *   (via src/lib/qaStatusCli.ts).
 * - ChatGPT writes only individual files under qa-results/ in the private
 *   repository. This module decides which results are valid; it never marks
 *   a check completed by itself.
 *
 * Rules:
 * - Every current event has one check per QA_CATEGORIES entry. New events
 *   start "pending".
 * - A check reopens (status "pending") when its own category fingerprint
 *   changes or its next_check_at deadline passes. Issue history is kept.
 * - Unchanged completed checks are kept, with their date and evidence.
 * - A result can close a check only if the event id, category and
 *   fingerprint match the register and it carries real evidence (an
 *   http(s) URL). music_genre completes only with
 *   method "independent_music_verification" and an external (non
 *   electroniccph.com) source; a "structural" genre check is recorded but
 *   leaves the check pending.
 * - Discovery and Production/technical QA are recorded per run, not per event.
 */
import { createHash } from "node:crypto";

export const QA_CATEGORIES = ["source_facts", "music_genre", "links", "duplicates", "about_language"] as const;
export type QaCategory = (typeof QA_CATEGORIES)[number];
export const RUN_LEVEL_CHECKS = ["discovery", "production_technical"] as const;
export type RunLevelCheck = (typeof RUN_LEVEL_CHECKS)[number];
export type IssueCategory = QaCategory | RunLevelCheck;

export const QA_STATUS_SCHEMA_VERSION = 2;
export const RESULT_FILE_SCHEMA_VERSION = 1;
/** A result is rejected when it was produced more than this long after the snapshot it checked. */
export const MAX_RESULT_SNAPSHOT_AGE_MS = 26 * 3_600_000;

export type CheckStatus = "pending" | "completed" | "issue" | "blocked";
export type QaCheck = {
  subject_id: string;
  category: QaCategory;
  status: CheckStatus;
  /** The category fingerprint of the content this check is about. */
  source_fingerprint: string | null;
  /** true while the event is in the latest snapshot; past events stay as history. */
  current: boolean;
  checked_at: string | null;
  next_check_at: string | null;
  method: string | null;
  evidence: string[];
  reported_issue_ids: string[];
  /** music_genre only: last structural (not independent) check. Never completes the check. */
  structural_checked_at: string | null;
  last_result_file: string | null;
};
export type QaIssue = {
  id: string;
  subject_id: string;
  category: IssueCategory;
  summary: string;
  reported_at: string;
  resolved_at: string | null;
  result_file: string;
};
export type RunLevelRecord = { status: "completed" | "issue" | "blocked" | "not_run"; summary: string; evidence: string[]; issue_ids: string[] };
export type QaRun = {
  result_file: string;
  run_id: string | null;
  snapshot_generated_at: string | null;
  completed_at: string | null;
  processed_at: string;
  accepted: number;
  rejected: { ref: string; reason: string }[];
  discovery: RunLevelRecord | null;
  production_technical: RunLevelRecord | null;
};
export type QaStatus = {
  schema_version: 2;
  generation: number;
  snapshot_generated_at: string | null;
  last_reconciled_at: string | null;
  checks: QaCheck[];
  reported_issues: QaIssue[];
  runs: QaRun[];
  processed_result_files: string[];
  coverage: Record<QaCategory, Record<CheckStatus, number>> | null;
};
export type QaInput = { subject_id: string; category: QaCategory; source_fingerprint: string | null };

export function emptyQaStatus(): QaStatus {
  return { schema_version: 2, generation: 0, snapshot_generated_at: null, last_reconciled_at: null, checks: [], reported_issues: [], runs: [], processed_result_files: [], coverage: null };
}

const isDate = (x: unknown) => x === null || (typeof x === "string" && Number.isFinite(Date.parse(x)));
const isStrings = (x: unknown) => Array.isArray(x) && x.every((v) => typeof v === "string");
const STATUSES: CheckStatus[] = ["pending", "completed", "issue", "blocked"];
const ISSUE_CATEGORIES: readonly string[] = [...QA_CATEGORIES, ...RUN_LEVEL_CHECKS];

export function validateQaStatus(value: unknown): asserts value is QaStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid QA status");
  const s = value as QaStatus;
  if (
    s.schema_version !== QA_STATUS_SCHEMA_VERSION || !Number.isSafeInteger(s.generation) || s.generation < 0 ||
    !isDate(s.snapshot_generated_at) || !isDate(s.last_reconciled_at) || !Array.isArray(s.checks) ||
    !Array.isArray(s.reported_issues) || !Array.isArray(s.runs) || !isStrings(s.processed_result_files)
  ) throw new Error("Invalid QA status schema");
  const keys = new Set<string>();
  for (const c of s.checks) {
    if (
      !c || typeof c.subject_id !== "string" || !c.subject_id || !QA_CATEGORIES.includes(c.category) || !STATUSES.includes(c.status) ||
      !(c.source_fingerprint === null || typeof c.source_fingerprint === "string") || typeof c.current !== "boolean" ||
      !isDate(c.checked_at) || !isDate(c.next_check_at) || !isDate(c.structural_checked_at) ||
      !isStrings(c.evidence) || !isStrings(c.reported_issue_ids)
    ) throw new Error("Invalid QA check");
    if ((c.status === "completed" || c.status === "issue") && (!c.checked_at || !c.evidence.some(isEvidenceUrl))) {
      throw new Error(`QA check ${c.subject_id}/${c.category} is ${c.status} without a check date and evidence`);
    }
    const k = JSON.stringify([c.subject_id, c.category]);
    if (keys.has(k)) throw new Error("Duplicate QA check: " + k);
    keys.add(k);
  }
  const issueIds = new Set<string>();
  for (const i of s.reported_issues) {
    if (
      !i || typeof i.id !== "string" || !i.id || typeof i.subject_id !== "string" || !ISSUE_CATEGORIES.includes(i.category) ||
      typeof i.summary !== "string" || !isDate(i.reported_at) || i.reported_at === null || !isDate(i.resolved_at) || issueIds.has(i.id)
    ) throw new Error("Invalid/duplicate issue");
    issueIds.add(i.id);
  }
}

function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  }
  return value;
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

/** Snapshot fields one category's check is about — reused from buildQaInputs, plus about_language. */
export type CategoryFingerprintInput = {
  title: string; description: string | null; artists: string[]; start_datetime: string; end_datetime: string | null;
  venue_id: string; sub_venue: string | null; primary_genre: string; subgenres: string[]; genre_confidence: string;
  official_event_url: string | null; ticket_url: string | null; facebook_url: string | null; resident_advisor_url: string | null;
  other_source_urls: string[]; sold_out: boolean; cancelled: boolean; postponed: boolean;
  source_links: { source_id: string; source_url: string; role: string }[];
};
export function categoryFingerprints(e: CategoryFingerprintInput): Record<QaCategory, string> {
  const links = [...e.source_links].sort((a, b) => `${a.source_id}|${a.role}`.localeCompare(`${b.source_id}|${b.role}`));
  return {
    source_facts: fingerprint({
      title: e.title, artists: e.artists, start: e.start_datetime, end: e.end_datetime, venue: e.venue_id, room: e.sub_venue,
      cancelled: e.cancelled, postponed: e.postponed, sold_out: e.sold_out,
      source_links: links.filter((x) => x.role === "official").map((x) => [x.source_id, x.source_url]),
    }),
    music_genre: fingerprint({ artists: e.artists, title: e.title, primary: e.primary_genre, subgenres: e.subgenres, confidence: e.genre_confidence }),
    links: fingerprint({
      official: e.official_event_url, ticket: e.ticket_url, ra: e.resident_advisor_url, facebook: e.facebook_url, other: e.other_source_urls,
      source_links: links.map((x) => [x.source_id, x.source_url, x.role]),
    }),
    duplicates: fingerprint({ title: e.title, artists: e.artists, venue: e.venue_id, room: e.sub_venue, start: e.start_datetime, official: e.official_event_url, ticket: e.ticket_url }),
    about_language: fingerprint({ title: e.title, description: e.description }),
  };
}

function summarize(checks: QaCheck[]): QaStatus["coverage"] {
  const coverage = Object.fromEntries(QA_CATEGORIES.map((c) => [c, { pending: 0, completed: 0, issue: 0, blocked: 0 }])) as NonNullable<QaStatus["coverage"]>;
  for (const c of checks) if (c.current) coverage[c.category][c.status] += 1;
  return coverage;
}

/** Reused reconcile: new → pending; changed fingerprint or passed deadline → pending; unchanged → kept. */
export function reconcileQaStatus(previous: QaStatus, incoming: QaInput[], snapshotAt: string): QaStatus {
  validateQaStatus(previous);
  if (!isDate(snapshotAt) || !snapshotAt) throw new Error("Invalid snapshot timestamp");
  if (previous.snapshot_generated_at && Date.parse(snapshotAt) < Date.parse(previous.snapshot_generated_at)) {
    throw new Error("Stale snapshot: refusing to roll QA status backwards");
  }
  const map = new Map(previous.checks.map((c) => [JSON.stringify([c.subject_id, c.category]), { ...c, current: false }]));
  const seen = new Set<string>();
  for (const item of incoming) {
    if (!QA_CATEGORIES.includes(item.category) || !item.subject_id) throw new Error("Invalid incoming check");
    const k = JSON.stringify([item.subject_id, item.category]);
    if (seen.has(k)) throw new Error("Duplicate incoming check: " + k);
    seen.add(k);
    const old = map.get(k);
    if (!old) {
      map.set(k, {
        ...item, status: "pending", current: true, checked_at: null, next_check_at: null, method: null, evidence: [],
        reported_issue_ids: [], structural_checked_at: null, last_result_file: null,
      });
    } else if (old.source_fingerprint !== item.source_fingerprint || (old.next_check_at !== null && Date.parse(old.next_check_at) <= Date.parse(snapshotAt))) {
      map.set(k, {
        ...old, source_fingerprint: item.source_fingerprint, status: "pending", current: true, checked_at: null, next_check_at: null,
        method: null, evidence: [], structural_checked_at: null, reported_issue_ids: [...old.reported_issue_ids],
      });
    } else {
      map.set(k, { ...old, current: true });
    }
  }
  // Subjects no longer in the snapshot are retained as history (current: false), never removed or marked complete.
  const checks = [...map.values()];
  return { ...previous, generation: previous.generation + 1, snapshot_generated_at: snapshotAt, last_reconciled_at: snapshotAt, checks, coverage: summarize(checks) };
}

function isEvidenceUrl(x: string): boolean {
  try {
    const u = new URL(x);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
const isSiteUrl = (x: string) => /^https?:\/\/(www\.)?electroniccph\.com(\/|$)/i.test(x);

type Row = Record<string, unknown>;
const asStrings = (x: unknown): string[] | null => (isStrings(x) ? (x as string[]) : null);

function readRunLevel(x: unknown, file: string, issues: QaIssue[], rejected: QaRun["rejected"], ref: RunLevelCheck, completedAt: string): RunLevelRecord | null {
  if (x == null) return null;
  const r = x as Row;
  const status = r.status;
  if (status !== "completed" && status !== "issue" && status !== "blocked" && status !== "not_run") {
    rejected.push({ ref, reason: "invalid status" });
    return null;
  }
  const evidence = asStrings(r.evidence ?? []) ?? [];
  if ((status === "completed" || status === "issue") && !evidence.some(isEvidenceUrl)) {
    rejected.push({ ref, reason: `${status} without an evidence URL` });
    return { status: "not_run", summary: "rejected: no evidence", evidence: [], issue_ids: [] };
  }
  const ids: string[] = [];
  for (const raw of Array.isArray(r.issues) ? (r.issues as Row[]) : []) {
    if (typeof raw?.id !== "string" || !raw.id || typeof raw.summary !== "string") {
      rejected.push({ ref, reason: "issue without id/summary" });
      continue;
    }
    ids.push(raw.id);
    issues.push({ id: raw.id, subject_id: `site:${ref}`, category: ref, summary: raw.summary, reported_at: completedAt, resolved_at: null, result_file: file });
  }
  return { status, summary: typeof r.summary === "string" ? r.summary : "", evidence, issue_ids: ids };
}

/**
 * Applies ChatGPT result files to the register (before reconciling the new
 * snapshot, so results are matched against the fingerprints they checked).
 * Files are processed once each, in name order. Invalid results are recorded
 * as rejected with a reason; they never change a check.
 */
export function applyQaResults(previous: QaStatus, files: { name: string; content: string }[], now: Date): QaStatus {
  validateQaStatus(previous);
  const status: QaStatus = structuredClone(previous);
  const byKey = new Map(status.checks.map((c) => [JSON.stringify([c.subject_id, c.category]), c]));
  const issueById = new Map(status.reported_issues.map((i) => [i.id, i]));

  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (status.processed_result_files.includes(file.name)) continue;
    const rejected: QaRun["rejected"] = [];
    const run: QaRun = { result_file: file.name, run_id: null, snapshot_generated_at: null, completed_at: null, processed_at: now.toISOString(), accepted: 0, rejected, discovery: null, production_technical: null };
    status.processed_result_files.push(file.name);

    let doc: Row;
    try {
      doc = JSON.parse(file.content) as Row;
    } catch {
      rejected.push({ ref: file.name, reason: "invalid JSON" });
      status.runs.push(run);
      continue;
    }
    if (doc?.type !== "qa_results") continue; // e.g. the write test file: ignored, not a run
    run.run_id = typeof doc.run_id === "string" ? doc.run_id : null;
    run.snapshot_generated_at = typeof doc.snapshot_generated_at === "string" ? doc.snapshot_generated_at : null;
    run.completed_at = typeof doc.completed_at === "string" ? doc.completed_at : null;
    const fileReject = (reason: string) => {
      rejected.push({ ref: file.name, reason });
      status.runs.push(run);
    };
    if (doc.schema_version !== RESULT_FILE_SCHEMA_VERSION) { fileReject("unsupported schema_version"); continue; }
    if (!run.snapshot_generated_at || !isDate(run.snapshot_generated_at) || !run.completed_at || !isDate(run.completed_at)) { fileReject("missing snapshot_generated_at/completed_at"); continue; }
    if (run.snapshot_generated_at !== status.snapshot_generated_at) { fileReject(`checked snapshot ${run.snapshot_generated_at}, register is at ${status.snapshot_generated_at}`); continue; }
    if (Date.parse(run.completed_at) - Date.parse(run.snapshot_generated_at) > MAX_RESULT_SNAPSHOT_AGE_MS) { fileReject("snapshot was stale when the QA ran"); continue; }
    if (Date.parse(run.completed_at) > now.getTime() + 5 * 60_000) { fileReject("completed_at is in the future"); continue; }

    const newIssues: QaIssue[] = [];
    run.discovery = readRunLevel(doc.discovery, file.name, newIssues, rejected, "discovery", run.completed_at);
    run.production_technical = readRunLevel(doc.production_technical, file.name, newIssues, rejected, "production_technical", run.completed_at);
    if (!run.discovery) rejected.push({ ref: "discovery", reason: "missing: discovery must be reported each run" });
    if (!run.production_technical) rejected.push({ ref: "production_technical", reason: "missing: production_technical must be reported each run" });

    for (const [n, raw] of (Array.isArray(doc.results) ? (doc.results as Row[]) : []).entries()) {
      const ref = `results[${n}] ${String(raw?.event_id)}/${String(raw?.category)}`;
      const reject = (reason: string) => rejected.push({ ref, reason });
      const check = byKey.get(JSON.stringify([raw?.event_id, raw?.category]));
      if (!check) { reject("unknown event_id/category"); continue; }
      if (!check.current) { reject("event is no longer current"); continue; }
      if (raw.fingerprint !== check.source_fingerprint) { reject("fingerprint does not match the checked content"); continue; }
      const resultStatus = raw.status;
      if (resultStatus !== "completed" && resultStatus !== "issue" && resultStatus !== "blocked") { reject("invalid status"); continue; }
      const checkedAt = typeof raw.checked_at === "string" && isDate(raw.checked_at) ? raw.checked_at : null;
      if (!checkedAt) { reject("missing checked_at"); continue; }
      const evidence = asStrings(raw.evidence ?? []);
      if (!evidence) { reject("evidence must be a list of strings"); continue; }
      const method = typeof raw.method === "string" ? raw.method : null;
      if (raw.next_check_at != null && (typeof raw.next_check_at !== "string" || !isDate(raw.next_check_at))) { reject("invalid next_check_at"); continue; }

      const resultIssues: QaIssue[] = [];
      let badIssue = false;
      for (const i of Array.isArray(raw.issues) ? (raw.issues as Row[]) : []) {
        if (typeof i?.id !== "string" || !i.id || typeof i.summary !== "string") { badIssue = true; break; }
        resultIssues.push({ id: i.id, subject_id: check.subject_id, category: check.category, summary: i.summary, reported_at: checkedAt, resolved_at: null, result_file: file.name });
      }
      if (badIssue) { reject("issue without id/summary"); continue; }
      const resolved = asStrings(raw.resolved_issue_ids ?? []) ?? [];

      if (check.category === "music_genre" && method === "structural") {
        // Structural genre checks are documentation only: the check stays open.
        check.structural_checked_at = checkedAt;
        check.last_result_file = file.name;
        run.accepted += 1;
        continue;
      }
      if (resultStatus === "completed" || resultStatus === "issue") {
        if (!evidence.some(isEvidenceUrl)) { reject(`${resultStatus} without an evidence URL`); continue; }
        if (check.category === "music_genre") {
          if (method !== "independent_music_verification") { reject('music_genre needs method "independent_music_verification" (or "structural", which stays pending)'); continue; }
          if (!evidence.some((x) => isEvidenceUrl(x) && !isSiteUrl(x))) { reject("music_genre needs an external (non-electroniccph.com) source"); continue; }
        }
      }
      if (resultStatus === "issue" && resultIssues.length === 0) { reject("status issue without an issue"); continue; }
      if (resultStatus === "blocked" && evidence.length === 0 && resultIssues.length === 0) { reject("blocked without a reason"); continue; }

      check.status = resultStatus;
      check.checked_at = checkedAt;
      check.method = method;
      check.evidence = evidence;
      check.next_check_at = (raw.next_check_at as string | undefined) ?? null;
      check.last_result_file = file.name;
      for (const id of resolved) {
        const known = issueById.get(id);
        if (known && known.subject_id === check.subject_id && !known.resolved_at) known.resolved_at = checkedAt;
      }
      newIssues.push(...resultIssues);
      check.reported_issue_ids = [...new Set([...check.reported_issue_ids, ...resultIssues.map((i) => i.id)])];
      run.accepted += 1;
    }
    for (const i of newIssues) {
      if (issueById.has(i.id)) continue; // a repeated report keeps the first date
      issueById.set(i.id, i);
      status.reported_issues.push(i);
    }
    status.runs.push(run);
  }
  status.coverage = summarize(status.checks);
  validateQaStatus(status);
  return status;
}
