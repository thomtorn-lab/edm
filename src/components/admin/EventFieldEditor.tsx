"use client";

import { GENRES } from "@/lib/taxonomy";

/**
 * Shared event-field editor (unified event create/edit model, 2026-09-08).
 * The three admin flows — Analyze/"Add event from URL", Discovery Queue
 * edit, and Published event edit — previously each hand-rolled their own
 * near-duplicate copy of these same field labels, ordering, and markup
 * (audited: title/description/dates/genre/URLs/free existed in at least two
 * of the three with subtly different labels/order every time). This is the
 * ONE place those now live — explicit typed props per field (value +
 * setter), no config/validation DSL, matching the task's own "don't
 * over-engineer" guidance.
 *
 * Deliberately does NOT own venue selection: Discovery Queue's free-text +
 * resolve + create-venue flow is genuinely different from Published's plain
 * venue-id select, and forcing them into one shape here would be exactly
 * the kind of artificial unification the task warns against. Callers render
 * their own venue control alongside this component.
 *
 * Field order (Section 12 of the unified event create/edit model task):
 * IDENTITY (title, description) -> WHEN (start, end) -> MUSIC (genre,
 * artists) -> LINKS (official/tickets/RA) -> STATUS (free, + published-only
 * sold out/cancelled/postponed). SubVenue is rendered by the caller directly
 * after WHERE (venue), which lives outside this component.
 */

export interface EventFieldEditorProps {
  idPrefix: string;
  mode: "draft" | "published";

  title: string;
  onTitleChange: (v: string) => void;

  description: string;
  onDescriptionChange: (v: string) => void;

  /** Omitted in "published" mode — EventManager has no start-date field today (see the unified event create/edit model audit's field matrix, row "date/start": no architectural reason for the gap, but changing an event's start date post-publish is a bigger, riskier operation than every other field here and is out of this task's scope to newly wire up). */
  startLocal?: string;
  onStartLocalChange?: (v: string) => void;

  endLocal: string;
  onEndLocalChange: (v: string) => void;

  genre: string;
  onGenreChange: (v: string) => void;
  /** "draft" mode allows an explicit unresolved option; "published" always has some genre. */
  allowUnresolvedGenre?: boolean;

  artists: string;
  onArtistsChange: (v: string) => void;

  officialEventUrl: string;
  onOfficialEventUrlChange: (v: string) => void;

  ticketUrl: string;
  onTicketUrlChange: (v: string) => void;

  residentAdvisorUrl: string;
  onResidentAdvisorUrlChange: (v: string) => void;

  free: boolean;
  onFreeChange: (v: boolean) => void;

  // Published-only lifecycle-adjacent status flags — never rendered in "draft" mode (a DQ candidate isn't a confirmed event yet; DQ already has an equivalent concept at the classification layer, holdReason "source_cancelled"/"negative_relevance" — see the unified event create/edit model audit's canonical field model, section C).
  soldOut?: boolean;
  onSoldOutChange?: (v: boolean) => void;
  cancelled?: boolean;
  onCancelledChange?: (v: boolean) => void;
  postponed?: boolean;
  onPostponedChange?: (v: boolean) => void;

  // Legacy Facebook URL (unified event create/edit model, 2026-09-08 —
  // Facebook decision): Facebook is no longer a distinct public link role
  // (src/lib/links.ts), so this is never shown in "draft" mode and is kept
  // out of the primary LINKS group even in "published" mode — a genuinely
  // separate legacy value some historical events still carry, editable but
  // clearly marked internal-only.
  facebookUrl?: string;
  onFacebookUrlChange?: (v: string) => void;
}

const inputCls = "mt-1 w-full rounded border border-border-strong bg-surface-1 px-2 py-1 text-xs text-text-primary";
const labelCls = "block text-[10px] font-semibold uppercase tracking-wide text-text-tertiary";

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

type TopProps = Pick<
  EventFieldEditorProps,
  "idPrefix" | "title" | "onTitleChange" | "description" | "onDescriptionChange" | "startLocal" | "onStartLocalChange" | "endLocal" | "onEndLocalChange"
>;

/**
 * IDENTITY (title, description) + WHEN (start, end) — rendered before the
 * caller's own venue control, matching Section 12's field order (IDENTITY
 * -> WHEN -> WHERE -> MUSIC -> LINKS -> STATUS). Split from
 * EventFieldEditorBottom (rather than one component owning the whole
 * order) specifically so venue selection — genuinely different between
 * Discovery Queue's free-text/create-venue flow and Published's plain
 * select, deliberately left to the caller (see this module's own doc
 * comment) — can sit in its correct WHERE position between the two.
 */
export function EventFieldEditorTop(props: TopProps) {
  const id = (suffix: string) => `${props.idPrefix}-${suffix}`;
  return (
    <>
      <Field id={id("title")} label="Title">
        <input id={id("title")} value={props.title} onChange={(e) => props.onTitleChange(e.target.value)} className={inputCls} />
      </Field>
      <Field id={id("description")} label="Description">
        <textarea id={id("description")} value={props.description} onChange={(e) => props.onDescriptionChange(e.target.value)} rows={2} className={inputCls} />
      </Field>
      {props.startLocal !== undefined && props.onStartLocalChange && (
        <Field id={id("start")} label="Date &amp; time">
          <input
            id={id("start")}
            type="datetime-local"
            value={props.startLocal}
            onChange={(e) => props.onStartLocalChange?.(e.target.value)}
            className={inputCls}
          />
        </Field>
      )}
      <Field id={id("end")} label="End time (optional — leave blank when unknown)">
        <input id={id("end")} type="datetime-local" value={props.endLocal} onChange={(e) => props.onEndLocalChange(e.target.value)} className={inputCls} />
      </Field>
    </>
  );
}

type BottomProps = Omit<EventFieldEditorProps, Exclude<keyof TopProps, "idPrefix">>;

/** MUSIC + LINKS + STATUS — see EventFieldEditorTop's own doc comment for why this is split. */
export function EventFieldEditorBottom(props: BottomProps) {
  const { idPrefix, mode } = props;
  const id = (suffix: string) => `${idPrefix}-${suffix}`;
  return (
    <>
      <Field id={id("genre")} label="Genre">
        <select id={id("genre")} value={props.genre} onChange={(e) => props.onGenreChange(e.target.value)} className={inputCls}>
          {props.allowUnresolvedGenre && <option value="">Unresolved</option>}
          {GENRES.map((g) => (
            <option key={g.slug} value={g.slug}>{g.label}</option>
          ))}
        </select>
      </Field>
      <Field id={id("artists")} label="Artists / lineup (comma-separated)">
        <input id={id("artists")} value={props.artists} onChange={(e) => props.onArtistsChange(e.target.value)} className={inputCls} />
      </Field>

      <Field id={id("official-url")} label="Official event URL">
        <input id={id("official-url")} value={props.officialEventUrl} onChange={(e) => props.onOfficialEventUrlChange(e.target.value)} className={inputCls} />
      </Field>
      <Field id={id("ticket-url")} label="Ticket URL">
        <input id={id("ticket-url")} value={props.ticketUrl} onChange={(e) => props.onTicketUrlChange(e.target.value)} className={inputCls} />
      </Field>
      <Field id={id("ra-url")} label="Resident Advisor URL">
        <input id={id("ra-url")} value={props.residentAdvisorUrl} onChange={(e) => props.onResidentAdvisorUrlChange(e.target.value)} className={inputCls} />
      </Field>

      <label className="flex items-center gap-2 text-xs text-text-primary">
        <input type="checkbox" checked={props.free} onChange={(e) => props.onFreeChange(e.target.checked)} />
        Free entry (does not affect the Tickets link if a ticket URL is also set)
      </label>
      {mode === "published" && (
        <>
          <label className="flex items-center gap-2 text-xs text-text-primary">
            <input type="checkbox" checked={props.soldOut ?? false} onChange={(e) => props.onSoldOutChange?.(e.target.checked)} />
            Sold out
          </label>
          <label className="flex items-center gap-2 text-xs text-text-primary">
            <input type="checkbox" checked={props.cancelled ?? false} onChange={(e) => props.onCancelledChange?.(e.target.checked)} />
            Cancelled
          </label>
          <label className="flex items-center gap-2 text-xs text-text-primary">
            <input type="checkbox" checked={props.postponed ?? false} onChange={(e) => props.onPostponedChange?.(e.target.checked)} />
            Postponed (no confirmed new date yet — clears automatically once a sync brings in a real reschedule)
          </label>
          {props.onFacebookUrlChange && (
            <Field id={id("facebook-url")} label="Legacy Facebook URL (internal — not a public link; see Official event URL)">
              <input id={id("facebook-url")} value={props.facebookUrl ?? ""} onChange={(e) => props.onFacebookUrlChange?.(e.target.value)} className={inputCls} />
            </Field>
          )}
        </>
      )}
    </>
  );
}

/** Convenience wrapper rendering Top immediately followed by Bottom, for a caller with no venue control of its own (e.g. a future flow with no venue step). */
export default function EventFieldEditor(props: EventFieldEditorProps) {
  return (
    <div className="space-y-2">
      <EventFieldEditorTop {...props} />
      <EventFieldEditorBottom {...props} />
    </div>
  );
}
