"use client";

import { useState, type FormEvent } from "react";
import { isValidEmail } from "@/lib/validation";

type Status = "idle" | "submitting" | "success" | "error";
type FieldErrors = Partial<Record<"name" | "email" | "message", string>>;

const inputClasses =
  "mt-1 w-full rounded border border-border-strong bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent";
const labelClasses = "block text-xs font-semibold uppercase tracking-wide text-text-secondary";
const errorClasses = "mt-1 text-xs text-status-bad";
const DEFAULT_ERROR_MESSAGE = "Something went wrong sending your message. Please try again in a moment.";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = "Enter your name.";
    if (!email.trim()) errors.email = "Enter your email.";
    else if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
    if (!message.trim()) errors.message = "Enter a message.";
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
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, company }),
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
        Thanks — we&rsquo;ve received your message. We may not be able to reply to every message, but
        we review them all.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
      <div>
        <label htmlFor="contact-name" className={labelClasses}>
          Name
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? "contact-name-error" : undefined}
          className={inputClasses}
        />
        {fieldErrors.name && (
          <p id="contact-name-error" className={errorClasses}>
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="contact-email" className={labelClasses}>
          Email
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "contact-email-error" : undefined}
          className={inputClasses}
        />
        {fieldErrors.email && (
          <p id="contact-email-error" className={errorClasses}>
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="contact-message" className={labelClasses}>
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={fieldErrors.message ? true : undefined}
          aria-describedby={fieldErrors.message ? "contact-message-error" : undefined}
          className={inputClasses}
        />
        {fieldErrors.message && (
          <p id="contact-message-error" className={errorClasses}>
            {fieldErrors.message}
          </p>
        )}
      </div>

      {/* Honeypot: hidden from real visitors, invisible to screen readers, irresistible to bots. */}
      <div className="absolute left-[-9999px]" aria-hidden="true">
        <label htmlFor="contact-company">Company</label>
        <input
          id="contact-company"
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
        Used only to reply to you — not stored, not shared.
      </p>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="self-start rounded border border-accent bg-accent/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50"
      >
        {status === "submitting" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
