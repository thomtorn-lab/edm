/**
 * Identity evidence contract (Artist Alerts owns the shared artist identity
 * model, owner decision 2026-10-24). Every enrichment that knows something
 * about WHO a lineup name is — today the source's own SoundCloud links,
 * later possibly other profile links — reports it in this one shape. There
 * is no second identity key: `key` is always artistIdentityKey(), and the
 * decision whether evidence is accepted, a candidate or a conflict is made
 * by the identity rules, not by the enrichment that observed it.
 *
 * Types only for now. Storage (one evidence table referencing artists and
 * events) is part of Phase A2 and needs its own migration approval.
 */

/** What the evidence points at. Only SoundCloud profiles exist today. */
export type EvidenceKind = "soundcloud_profile";

/**
 * How the evidence was obtained, strongest first. Only the two source_*
 * signals may ever make an appearance high-confidence on their own; the
 * others can only produce review candidates.
 */
export type EvidenceSignal =
  /** A structured link the source attaches to this exact lineup name on this event (Culture Box anchors). */
  | "source_anchor"
  /** "Name — soundcloud.com/x" written by the source in this event's own lineup or description text. */
  | "source_inline"
  /** Derived via Resident Advisor event -> RA artist -> profile. Candidate only. */
  | "ra_chain"
  /** A profile URL listed on a Discogs artist page. Candidate only. */
  | "discogs_url"
  /**
   * "Name — soundcloud.com/x" in the text of an admin-created event (no
   * canonical source). An admin often pastes promoter text, so this is not
   * the venue's own statement: candidate only, confirmed through review.
   */
  | "admin_inline";

export const SOURCE_SIGNALS: readonly EvidenceSignal[] = ["source_anchor", "source_inline"];

/**
 * sourceId for evidence from an admin-created event (canonical_source_id is
 * null). Matches event_change_log.changed_by for admin edits. Never pair it
 * with a source_* signal: use "admin_inline".
 */
export const ADMIN_EVIDENCE_SOURCE_ID = "admin";

export type EvidenceConflict =
  /** The same event links one lineup name to two different profiles. */
  | "two_handles_same_event"
  /** One identity key is linked to different profiles across events (e.g. Culture Box "LELE" / "LeLe"). */
  | "two_handles_same_key"
  /** The entry is a duo, collective, label or multi-act line — never attached to one artist. */
  | "entry_not_single_artist";

export interface IdentityEvidence {
  kind: EvidenceKind;
  /** The lineup entry exactly as stored in events.artists. */
  entry: string;
  /** The performer within that entry the profile belongs to (an "A B2B B" entry yields one record per part). */
  part: string;
  /** artistIdentityKey(part): the identity key of that performer. */
  key: string;
  /** Normalised profile URL, e.g. https://soundcloud.com/<handle>. */
  url: string;
  signal: EvidenceSignal;
  sourceId: string;
  /** Null only for a candidate observed before its event exists. */
  eventId: string | null;
  /** The page the evidence was read from. */
  sourceUrl: string | null;
  observedAt: Date;
  /** Set when the observation itself is contradictory; such evidence is never used to link. */
  conflict: { kind: EvidenceConflict; otherUrls: string[] } | null;
}

/**
 * Whether one piece of evidence may, on its own, mark an appearance as
 * source-backed (classifyAppearance's hasSourceHandle). Conflicts and
 * candidate-only signals never may. Cross-event reuse of a handle is a
 * separate rule (unique key, no competing handle) applied by the identity
 * model, not by this check.
 */
export function evidenceBacksAppearance(e: IdentityEvidence): boolean {
  return e.conflict === null && SOURCE_SIGNALS.includes(e.signal) && e.eventId !== null && e.sourceId !== ADMIN_EVIDENCE_SOURCE_ID;
}
