"use client";

import { useState, type FormEvent } from "react";
import { isValidEmail } from "@/lib/validation";

type Status = "idle" | "submitting" | "success" | "error";
const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again in a moment.";

/**
 * Compact, single-field signup (product requirement: "email-only initial
 * signup", genre preferences come after confirmation — see
 * /newsletter/manage). Mirrors ContactForm.tsx's own status-machine/
 * honeypot/validation conventions exactly, kept to one input so it reads
 * as one line even on a narrow phone screen (placement requirement:
 * compact, between the homepage intro and the event list, never
 * displacing the sticky filter bar below it).
 */
export default function NewsletterSignupForm() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    if (!email.trim() || !isValidEmail(email)) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError(null);
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company }),
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
      <p role="status" className="text-sm text-text-secondary">
        Check your email to confirm your subscription.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <label htmlFor="newsletter-email" className="shrink-0 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Weekly newsletter
        </label>
        <div className="flex gap-2">
          <input
            id="newsletter-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "newsletter-email-error" : undefined}
            className="w-full min-w-0 rounded border border-border-strong bg-surface-1 px-3 py-1.5 text-base leading-5 text-text-primary placeholder:text-text-tertiary focus:border-accent sm:w-56 sm:text-xs"
          />
          {/* Honeypot — hidden from real visitors via CSS, never via a
              non-rendered input (which some bots skip), same pattern as
              ContactForm/SuggestEventForm. */}
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute h-0 w-0 opacity-0"
          />
          <button
            type="submit"
            disabled={status === "submitting"}
            className="shrink-0 rounded border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50"
          >
            {status === "submitting" ? "…" : "Subscribe"}
          </button>
        </div>
      </div>
      {fieldError && (
        <p id="newsletter-email-error" role="alert" className="text-xs text-status-bad">{fieldError}</p>
      )}
      {status === "error" && errorMessage && <p role="alert" className="text-xs text-status-bad">{errorMessage}</p>}
    </form>
  );
}
