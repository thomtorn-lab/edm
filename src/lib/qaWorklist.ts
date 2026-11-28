/**
 * Prioritised QA worklist for the external ChatGPT QA (2026-11-28).
 *
 * Built by src/lib/qaStatusCli.ts from the same snapshot and the freshly
 * reconciled register, and committed next to them as qa-worklist.json. It
 * lets the QA work from one compact file instead of the full snapshot
 * (which carries the whole change log).
 *
 * Read-only and deterministic: it never changes the register, never marks a
 * check completed and never decides that something is wrong. Structural
 * findings come only from the site's existing rules and helpers, and each
 * one says what kind of statement it is:
 *   - "rule_violation": breaks a documented platform rule (genre tag rules
 *     in taxonomy.validateGenreTags, the HvadErPå Official URL ban in
 *     officialUrlPolicy, one entry per artist per lineup as dedupeArtistList
 *     enforces at import). A documented error in the stored data.
 *   - "observation": an objectively established fact that is NOT an error
 *     by itself (TBA in a lineup, no ABOUT text, Official Event = Tickets,
 *     Danish ABOUT text). The QA decides.
 *   - "candidate": a possible problem that needs external verification
 *     (possible duplicate event).
 */
import type { QaEvent, QaSnapshot } from "@/db/exportQaSnapshot";
import { isDanishAboutText } from "./aboutContent";
import { assessDuplicate, normalizeUrl } from "./dedup";
import { classifyArtistName } from "./enrichment/artistNameClassification";
import { readsAsDanish } from "./languageDetection";
import { normalizeArtistName } from "./normalize";
import { isHvaderpaaUrl } from "./officialUrlPolicy";
import type { QaCategory, QaCheck, QaStatus } from "./qaStatus";
import { validateGenreTags } from "./taxonomy";

export const QA_WORKLIST_SCHEMA_VERSION = 1;
const HOUR = 3_600_000;
export const IMMINENT_HOURS = 72;
export const SOON_HOURS = 7 * 24;
export const NEW_EVENT_HOURS = 48;
export const ABOUT_MAX_CHARS = 1200;

export type FindingKind = "rule_violation" | "observation" | "candidate";
export type FindingCode =
  | "genre_too_many"
  | "genre_fallback_combined"
  | "genre_parent_and_subgenre"
  | "genre_duplicate"
  | "genre_unknown"
  | "official_url_is_hvaderpaa"
  | "lineup_duplicate_artist"
  | "lineup_placeholder"
  | "no_about_text"
  | "no_official_url"
  | "official_equals_ticket"
  | "about_hidden_as_danish"
  | "about_reads_danish"
  | "possible_duplicate_event";

export interface StructuralFinding {
  code: FindingCode;
  kind: FindingKind;
  /** The QA categories this finding is relevant to. */
  categories: QaCategory[];
  detail: string;
}

/** How much a finding raises an event's priority. Rule violations and candidates outrank observations. */
const FINDING_WEIGHT: Record<FindingCode, number> = {
  genre_too_many: 100,
  genre_fallback_combined: 100,
  genre_parent_and_subgenre: 100,
  genre_duplicate: 100,
  genre_unknown: 100,
  official_url_is_hvaderpaa: 100,
  lineup_duplicate_artist: 100,
  possible_duplicate_event: 60,
  lineup_placeholder: 15,
  no_official_url: 15,
  official_equals_ticket: 15,
  about_hidden_as_danish: 15,
  about_reads_danish: 10,
  no_about_text: 5,
};

export interface WorklistEvent {
  priority: number;
  reasons: string[];
  id: string;
  title: string;
  page_url: string;
  start_datetime: string;
  end_datetime: string | null;
  in_progress: boolean;
  hours_until_start: number;
  venue: { id: string; name: string | null };
  sub_venue: string | null;
  artists: string[];
  genres: string[];
  genre_confidence: string;
  /** Only the flags that are true: sold_out, cancelled, postponed, date_changed, time_changed. */
  status_flags: string[];
  links: QaEvent["links"];
  canonical_source_id: string | null;
  /** Source names are in the top-level `sources` map. */
  source_links: { source_id: string; role: string; url: string }[];
  /** ABOUT text (first ABOUT_MAX_CHARS characters), only when an about_language or source_facts check is open or a finding concerns it. The full text is on page_url. */
  about: string | null;
  about_truncated: boolean;
  last_changed: string | null;
  created_at: string | null;
  findings: StructuralFinding[];
  /** Open checks: category → fingerprint to copy exactly into the result file. */
  open_checks: Partial<Record<QaCategory, string | null>>;
  /** Open checks that had a result before and were reopened (content changed or next_check_at passed). */
  reopened: QaCategory[];
  open_issue_ids: string[];
  completed_categories: QaCategory[];
  /** Checks the QA reported as blocked (not open, not completed). */
  blocked_categories: QaCategory[];
}

export interface QaWorklist {
  schema_version: number;
  generated_at: string;
  snapshot_generated_at: string;
  /** Copied from qa-snapshot.json / qa-status.json, so the stop criteria can be checked here. */
  snapshot_validation_passed: boolean;
  register_snapshot_generated_at: string | null;
  register_generation: number;
  ordering: string;
  sources: Record<string, string>;
  summary: {
    events_in_snapshot: number;
    events_listed: number;
    pending_checks: number;
    new_events: number;
    reopened_events: number;
    imminent_events_with_pending_checks: number;
    findings_by_kind: Record<FindingKind, number>;
    findings_by_code: Partial<Record<FindingCode, number>>;
  };
  events: WorklistEvent[];
  notice: string;
}

const GENRE_PROBLEM_CODE: Record<string, FindingCode> = {
  "too-many": "genre_too_many",
  "fallback-combined": "genre_fallback_combined",
  "parent-and-subgenre": "genre_parent_and_subgenre",
  duplicate: "genre_duplicate",
  unknown: "genre_unknown",
};

/** Findings from one event's own fields, using only the site's existing rules. */
export function eventFindings(e: QaEvent): StructuralFinding[] {
  const out: StructuralFinding[] = [];
  // Stored legacy values are tolerated by the site (allowLegacy = the event's own tags), so they are not flagged.
  for (const p of validateGenreTags(e.subgenres, e.subgenres)) {
    const code = GENRE_PROBLEM_CODE[p.kind];
    if (code && !out.some((f) => f.code === code)) {
      out.push({ code, kind: "rule_violation", categories: ["music_genre"], detail: `genres: ${e.subgenres.join(", ")}` });
    }
  }
  if (e.links.official_event_url && isHvaderpaaUrl(e.links.official_event_url)) {
    out.push({ code: "official_url_is_hvaderpaa", kind: "rule_violation", categories: ["links", "source_facts"], detail: e.links.official_event_url });
  }
  const seen = new Map<string, string>();
  for (const a of e.artists) {
    const key = normalizeArtistName(a);
    if (key && seen.has(key)) out.push({ code: "lineup_duplicate_artist", kind: "rule_violation", categories: ["source_facts"], detail: `"${seen.get(key)}" and "${a}"` });
    else if (key) seen.set(key, a);
  }
  const placeholders = e.artists.filter((a) => /\b(tba|tbc|to be announced)\b/i.test(a) || classifyArtistName(a).verdict === "not_artist");
  if (placeholders.length > 0) {
    out.push({ code: "lineup_placeholder", kind: "observation", categories: ["source_facts"], detail: `not an artist name: ${placeholders.join(", ")}` });
  }
  if (!e.description || !e.description.trim()) out.push({ code: "no_about_text", kind: "observation", categories: ["about_language"], detail: "no ABOUT text stored" });
  if (!e.links.official_event_url) out.push({ code: "no_official_url", kind: "observation", categories: ["links", "source_facts"], detail: "no Official Event URL stored" });
  const official = normalizeUrl(e.links.official_event_url);
  if (official && official === normalizeUrl(e.links.ticket_url)) {
    out.push({ code: "official_equals_ticket", kind: "observation", categories: ["links"], detail: `Official Event and Tickets are the same URL: ${e.links.official_event_url}` });
  }
  if (e.description && isDanishAboutText(e.description)) {
    out.push({ code: "about_hidden_as_danish", kind: "observation", categories: ["about_language"], detail: "stored ABOUT is Danish; the public site does not show it" });
  } else if (e.description && readsAsDanish(e.description)) {
    out.push({ code: "about_reads_danish", kind: "observation", categories: ["about_language"], detail: "stored ABOUT reads as Danish and is shown publicly" });
  }
  return out;
}

/** Possible duplicates across all current events: the site's assessDuplicate (same night) or a shared Official/Tickets URL on any night. */
export function duplicateFindings(events: QaEvent[]): Map<string, StructuralFinding[]> {
  const out = new Map<string, StructuralFinding[]>();
  const push = (id: string, f: StructuralFinding) => out.set(id, [...(out.get(id) ?? []), f]);
  const cand = (e: QaEvent) => ({ title: e.title, artists: e.artists, venueId: e.venue.id, startDatetime: e.start_datetime, subVenue: e.sub_venue });
  const urls = (e: QaEvent) => [e.links.official_event_url, e.links.ticket_url].map(normalizeUrl).filter((u): u is string => Boolean(u));
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      const assessment = assessDuplicate(cand(a), cand(b));
      const ua = new Set(urls(a));
      const shared = urls(b).find((u) => ua.has(u));
      if (assessment.confidence === "none" && !shared) continue;
      const why = [assessment.confidence !== "none" ? `${assessment.confidence}: ${assessment.reasons.join("; ")}` : null, shared ? `shared URL ${shared}` : null].filter(Boolean).join("; ");
      push(a.id, { code: "possible_duplicate_event", kind: "candidate", categories: ["duplicates"], detail: `with ${b.id} "${b.title}" (${why})` });
      push(b.id, { code: "possible_duplicate_event", kind: "candidate", categories: ["duplicates"], detail: `with ${a.id} "${a.title}" (${why})` });
    }
  }
  return out;
}

export function buildQaWorklist(snapshot: QaSnapshot, status: QaStatus): QaWorklist {
  if (status.snapshot_generated_at !== snapshot.generated_at) throw new Error("Register and snapshot are from different exports");
  const now = Date.parse(snapshot.generated_at);
  const checksByEvent = new Map<string, QaCheck[]>();
  for (const c of status.checks) if (c.current) checksByEvent.set(c.subject_id, [...(checksByEvent.get(c.subject_id) ?? []), c]);
  const openIssues = new Map<string, string[]>();
  for (const i of status.reported_issues) if (!i.resolved_at) openIssues.set(i.subject_id, [...(openIssues.get(i.subject_id) ?? []), i.id]);
  const dupes = duplicateFindings(snapshot.events);

  const listed: WorklistEvent[] = [];
  let newEvents = 0, changedEvents = 0, imminentEvents = 0, pendingChecks = 0;
  for (const e of snapshot.events) {
    const checks = checksByEvent.get(e.id) ?? [];
    const pending = checks.filter((c) => c.status === "pending");
    const findings = [...eventFindings(e), ...(dupes.get(e.id) ?? [])];
    const hours = Math.round((Date.parse(e.start_datetime) - now) / HOUR);
    const reasons: string[] = [];
    let priority = 0;

    const isNew = e.created_at !== null && now - Date.parse(e.created_at) < NEW_EVENT_HOURS * HOUR;
    // Reopened = had a result and is open again because its fingerprint changed or next_check_at passed
    // (reconcileQaStatus keeps last_result_file and clears structural_checked_at). A structural-only
    // music_genre result leaves the check pending with structural_checked_at set: not a reopen.
    const reopened = pending.filter((c) => c.last_result_file !== null && c.structural_checked_at === null);
    const structuralOnly = pending.filter((c) => c.structural_checked_at !== null);
    if (pending.length > 0 && e.in_progress) reasons.push("in progress at export time (likely over before the QA runs)");
    else if (pending.length > 0 && hours < IMMINENT_HOURS) { priority += 50; reasons.push(`starts within ${IMMINENT_HOURS} h with open checks`); imminentEvents++; }
    else if (pending.length > 0 && hours < SOON_HOURS) { priority += 20; reasons.push("starts within 7 days with open checks"); }
    if (reopened.length > 0) { priority += 40; reasons.push(`reopened after a change: ${reopened.map((c) => c.category).join(", ")}`); changedEvents++; }
    if (structuralOnly.length > 0) reasons.push(`structural check only, independent verification outstanding: ${structuralOnly.map((c) => c.category).join(", ")}`);
    if (isNew) { priority += 30; reasons.push("new event (added within 48 h)"); newEvents++; }
    for (const f of findings) priority += FINDING_WEIGHT[f.code];
    for (const kind of ["rule_violation", "candidate", "observation"] as const) {
      const codes = [...new Set(findings.filter((f) => f.kind === kind).map((f) => f.code))];
      if (codes.length > 0) reasons.push(`${kind}: ${codes.join(", ")}`);
    }
    if (pending.length > 0) priority += 1;
    pendingChecks += pending.length;
    if (pending.length === 0 && !findings.some((f) => f.kind !== "observation")) continue; // nothing to do for this event

    const aboutNeeded = pending.some((c) => c.category === "about_language" || c.category === "source_facts") || findings.some((f) => f.categories.includes("about_language"));
    const about = aboutNeeded && e.description ? e.description : null;
    listed.push({
      priority,
      reasons,
      id: e.id,
      title: e.title,
      page_url: e.page_url,
      start_datetime: e.start_datetime,
      end_datetime: e.end_datetime,
      in_progress: e.in_progress,
      hours_until_start: hours,
      venue: { id: e.venue.id, name: e.venue.name },
      sub_venue: e.sub_venue,
      artists: e.artists,
      genres: e.subgenres,
      genre_confidence: e.genre_confidence,
      status_flags: Object.entries(e.status).filter(([, v]) => v).map(([k]) => k),
      links: e.links,
      canonical_source_id: e.canonical_source_id,
      source_links: e.source_links.map((l) => ({ source_id: l.source_id, role: l.role, url: l.source_url })),
      about: about && about.length > ABOUT_MAX_CHARS ? about.slice(0, ABOUT_MAX_CHARS) : about,
      about_truncated: Boolean(about && about.length > ABOUT_MAX_CHARS),
      last_changed: e.last_changed,
      created_at: e.created_at,
      findings,
      open_checks: Object.fromEntries(pending.map((c) => [c.category, c.source_fingerprint])),
      reopened: reopened.map((c) => c.category),
      open_issue_ids: openIssues.get(e.id) ?? [],
      completed_categories: checks.filter((c) => c.status === "completed").map((c) => c.category),
      blocked_categories: checks.filter((c) => c.status === "blocked").map((c) => c.category),
    });
  }
  listed.sort((a, b) => b.priority - a.priority || Date.parse(a.start_datetime) - Date.parse(b.start_datetime) || a.id.localeCompare(b.id));

  const allFindings = listed.flatMap((e) => e.findings);
  const byCode: Partial<Record<FindingCode, number>> = {};
  for (const f of allFindings) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
  return {
    schema_version: QA_WORKLIST_SCHEMA_VERSION,
    generated_at: snapshot.generated_at,
    snapshot_generated_at: snapshot.generated_at,
    snapshot_validation_passed: snapshot.validation.passed,
    register_snapshot_generated_at: status.snapshot_generated_at,
    register_generation: status.generation,
    sources: Object.fromEntries(snapshot.sources.map((s) => [s.id, s.source_name])),
    ordering:
      "priority descending, then start time. Priority adds: open checks on an event starting within 72 h (+50) or 7 days (+20; events already in progress at export time get no boost); checks reopened after a change (+40); new event (+30); each finding: rule_violation +100, candidate +60, observation +5 to +15.",
    summary: {
      events_in_snapshot: snapshot.events.length,
      events_listed: listed.length,
      pending_checks: pendingChecks,
      new_events: newEvents,
      reopened_events: changedEvents,
      imminent_events_with_pending_checks: imminentEvents,
      findings_by_kind: {
        rule_violation: allFindings.filter((f) => f.kind === "rule_violation").length,
        candidate: allFindings.filter((f) => f.kind === "candidate").length,
        observation: allFindings.filter((f) => f.kind === "observation").length,
      },
      findings_by_code: byCode,
    },
    events: listed,
    notice:
      "Generated from qa-snapshot.json and qa-status.json of the same export. rule_violation = breaks a documented platform rule; observation = an established fact that is not an error by itself; candidate = needs external verification. Nothing here completes a check: only a valid result file does.",
  };
}

/** Readable but compact: the header pretty-printed, one line per event. */
export function serializeQaWorklist(w: QaWorklist): string {
  const { events, ...head } = w;
  const header = JSON.stringify(head, null, 2);
  const body = events.map((e) => "    " + JSON.stringify(e)).join(",\n");
  return `${header.slice(0, -2)},\n  "events": [\n${body}\n  ]\n}\n`;
}
