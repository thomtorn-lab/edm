import type { EventRecord } from "@/lib/types";

interface StatusInfo {
  label: string;
  tone: "bad" | "neutral";
}

/**
 * "strong" (event listings, 2026-11-12): text and border in exactly the
 * event title's white (text-primary) — used by EventRow for SOLD OUT only.
 * Same background, typography, border width and padding as the other
 * tones. getEventStatuses never returns it, so other callers (the event
 * page) are unchanged.
 */
type BadgeTone = StatusInfo["tone"] | "strong";

/**
 * Public event-lifecycle statuses only (event lifecycle/status handling,
 * 2026-08-28). `timeChanged` is an internal data-quality flag and must never
 * surface here.
 *
 * No "Rescheduled" badge (2026-11-14): when an event gets a confirmed new
 * date the listing already shows that date, so the badge added little and
 * could cause doubt. `dateChanged` is still set by sync (buildSyncPatch in
 * lib/sync.ts) and kept as internal QA/history metadata — it just no longer
 * produces a public badge. "Postponed" (no confirmed new date) is unchanged.
 *
 * No "Cancelled" badge here (admin unpublish/cancellation safety,
 * 2026-09-06): a cancelled event must not remain publicly visible at all —
 * it's taken down entirely via admin unpublish (published=false,
 * adminUnpublishReason="cancelled"), never shown live with a badge. Public
 * pages only ever render already-published events, so `cancelled` itself
 * carries no public display meaning any more; it's left as internal/
 * historical metadata (see EventManager.tsx) rather than removed outright.
 */
export function getEventStatuses(
  event: Pick<EventRecord, "soldOut" | "postponed">,
): StatusInfo[] {
  const statuses: StatusInfo[] = [];
  if (event.postponed) statuses.push({ label: "Postponed", tone: "bad" });
  if (event.soldOut) statuses.push({ label: "Sold out", tone: "neutral" });
  return statuses;
}

export default function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
        (tone === "bad"
          ? "border-status-bad/40 text-status-bad"
          : tone === "strong"
            ? "border-text-primary text-text-primary"
            : "border-border-strong text-text-secondary-strong")
      }
    >
      {label}
    </span>
  );
}
