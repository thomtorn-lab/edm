"use client";

import { useState, type FormEvent } from "react";
import { isValidEmail, isValidHttpUrl } from "@/lib/validation";

type Status = "idle" | "submitting" | "success" | "error";
type FieldErrors = Partial<
  Record<"eventName" | "date" | "venue" | "eventUrl" | "contactEmail", string>
>;

const inputClasses =
  "mt-1 w-full rounded border border-border-strong bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent";
const labelClasses = "block text-xs font-semibold uppercase tracking-wide text-text-secondary";
const errorClasses = "mt-1 text-xs text-status-bad";
const DEFAULT_ERROR_MESSAGE = "Something went wrong sending your suggestion. Please try again in a moment.";

export default function SuggestEventForm() {
  const [eventName, setEventName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [eventUrl, setEventUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [note, setNote] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!eventName.trim()) errors.eventName = "Enter the event name.";
    if (!date.trim()) errors.date = "Enter a date.";
    if (!venue.trim()) errors.venue = "Enter the venue.";
    if (!eventUrl.trim()) errors.eventUrl = "Enter a link to the event.";
    else if (!isValidHttpUrl(eventUrl)) errors.eventUrl = "Enter a valid URL, starting with https://.";
    if (!contactEmail.trim()) errors.contactEmail = "Enter your email.";
    else if (!isValidEmail(contactEmail)) errors.contactEmail = "Enter a valid email address.";
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/suggest-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventName, date, venue, eventUrl, contactEmail, note, company }),
      });
      const data: unknown = await res.json().catch(() => null);
      const ok = res.ok && !!data && typeof data === "object" && (data as { ok?: unknown }).ok === true;
      if (!ok) {
        const serverMessage =
          data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : null;
        setErrorMessage(serverMessage ?? DEFAULT_ERROR_MESSAGE);
        setStatus("error");
        return;
      }
      setStatus("success");
    } catch {
      setErrorMessage(DEFAULT_ERROR_MESSAGE);
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="mt-6 rounded border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text-primary"
      >
        Thanks — your suggestion is in for review. Nothing publishes automatically; every
        suggestion is checked against an official or first-party source first.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
      <div>
        <label htmlFor="suggest-event-name" className={labelClasses}>
          Event name
        </label>
        <input
          id="suggest-event-name"
          name="eventName"
          type="text"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          aria-invalid={fieldErrors.eventName ? true : undefined}
          aria-describedby={fieldErrors.eventName ? "suggest-event-name-error" : undefined}
          className={inputClasses}
        />
        {fieldErrors.eventName && (
          <p id="suggest-event-name-error" className={errorClasses}>
            {fieldErrors.eventName}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="suggest-event-date" className={labelClasses}>
          Date
        </label>
        <input
          id="suggest-event-date"
          name="date"
          type="text"
          placeholder="e.g. 12 Sept 2026, or “every Friday”"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-invalid={fieldErrors.date ? true : undefined}
          aria-describedby={fieldErrors.date ? "suggest-event-date-error" : undefined}
          className={inputClasses}
        />
        {fieldErrors.date && (
          <p id="suggest-event-date-error" className={errorClasses}>
            {fieldErrors.date}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="suggest-event-venue" className={labelClasses}>
          Venue
        </label>
        <input
          id="suggest-event-venue"
          name="venue"
          type="text"
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          aria-invalid={fieldErrors.venue ? true : undefined}
          aria-describedby={fieldErrors.venue ? "suggest-event-venue-error" : undefined}
          className={inputClasses}
        />
        {fieldErrors.venue && (
          <p id="suggest-event-venue-error" className={errorClasses}>
            {fieldErrors.venue}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="suggest-event-url" className={labelClasses}>
          Event URL
        </label>
        <input
          id="suggest-event-url"
          name="eventUrl"
          type="url"
          placeholder="RA, tickets, official page, etc."
          value={eventUrl}
          onChange={(e) => setEventUrl(e.target.value)}
          aria-invalid={fieldErrors.eventUrl ? true : undefined}
          aria-describedby={fieldErrors.eventUrl ? "suggest-event-url-error" : undefined}
          className={inputClasses}
        />
        {fieldErrors.eventUrl && (
          <p id="suggest-event-url-error" className={errorClasses}>
            {fieldErrors.eventUrl}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="suggest-event-contact-email" className={labelClasses}>
          Contact email
        </label>
        <input
          id="suggest-event-contact-email"
          name="contactEmail"
          type="email"
          autoComplete="email"
          placeholder="In case we have a question about this"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          aria-invalid={fieldErrors.contactEmail ? true : undefined}
          aria-describedby={fieldErrors.contactEmail ? "suggest-event-contact-email-error" : undefined}
          className={inputClasses}
        />
        {fieldErrors.contactEmail && (
          <p id="suggest-event-contact-email-error" className={errorClasses}>
            {fieldErrors.contactEmail}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="suggest-event-note" className={labelClasses}>
          Note <span className="normal-case text-text-tertiary">(optional)</span>
        </label>
        <textarea
          id="suggest-event-note"
          name="note"
          rows={4}
          placeholder="Anything else worth knowing"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={inputClasses}
        />
      </div>

      {/* Honeypot: hidden from real visitors, invisible to screen readers, irresistible to bots. */}
      <div className="absolute left-[-9999px]" aria-hidden="true">
        <label htmlFor="suggest-event-company">Company</label>
        <input
          id="suggest-event-company"
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
      </div>

      {status === "error" && (
        <p role="alert" className={errorClasses}>
          {errorMessage ?? DEFAULT_ERROR_MESSAGE}
        </p>
      )}

      <p className="text-xs text-text-tertiary">
        Used only to review this suggestion — not stored, not shared.
      </p>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="self-start rounded border border-accent bg-accent/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50"
      >
        {status === "submitting" ? "Sending…" : "Suggest an event"}
      </button>
    </form>
  );
}
