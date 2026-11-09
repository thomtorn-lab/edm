"use client";

import { useState, type FormEvent } from "react";
import { isValidEmail } from "@/lib/validation";

const INPUT =
  "w-full min-w-0 rounded border border-border-strong bg-surface-1 px-3 py-1.5 text-base leading-5 text-text-primary placeholder:text-text-tertiary focus:border-accent sm:w-72 sm:text-sm";
const BUTTON =
  "shrink-0 rounded border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50";

/** "Manage Artist Alerts" without a link at hand: emails a confirmed subscriber their manage link. The answer never says whether the address is signed up. */
export default function ManageLinkForm() {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidEmail(email)) {
      setStatus("error");
      setMessage("Enter a valid email address.");
      return;
    }
    setStatus("submitting");
    setMessage(null);
    try {
      const res = await fetch("/api/artist-alerts/manage-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, company }) });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (!res.ok || !data?.ok) {
        setStatus("error");
        setMessage(data?.error ?? "Something went wrong. Please try again in a moment.");
        return;
      }
      setStatus("done");
      setMessage(data.message ?? null);
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again in a moment.");
    }
  }

  if (status === "done") {
    return (
      <p role="status" className="mt-6 text-sm text-text-secondary">
        {message}
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-3">
      <div className="flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          className={INPUT}
        />
        <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute h-0 w-0 opacity-0" />
        <button type="submit" disabled={status === "submitting"} className={BUTTON}>
          {status === "submitting" ? "…" : "Send management link"}
        </button>
      </div>
      {message && (
        <p role="alert" className="text-xs text-status-bad">
          {message}
        </p>
      )}
    </form>
  );
}
