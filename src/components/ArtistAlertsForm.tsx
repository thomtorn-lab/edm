"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { isValidEmail } from "@/lib/validation";

export interface ArtistOption {
  id: string;
  displayName: string;
  disambiguation: string | null;
  upcomingEvents: number;
}

interface FollowedArtist {
  artistId: string;
  displayName: string;
  state: "active" | "awaiting_confirmation" | "awaiting_verification" | "not_found";
}

type Status = "idle" | "submitting" | "success" | "error";

const INPUT =
  "w-full min-w-0 rounded border border-border-strong bg-surface-1 px-3 py-1.5 text-base leading-5 text-text-primary placeholder:text-text-tertiary focus:border-accent sm:text-sm";
const BUTTON =
  "shrink-0 rounded border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20 disabled:opacity-50";
const QUIET_BUTTON = "shrink-0 rounded border border-border-strong px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary";

const STATE_LABEL: Record<FollowedArtist["state"], string> = {
  active: "Following",
  awaiting_confirmation: "Awaiting confirmation",
  awaiting_verification: "Awaiting verification",
  not_found: "Could not be verified",
};

function normalize(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/**
 * The Artists page and the manage page share this one component (no new
 * event components): search the artist list, pick artists, or ask for one
 * that is not on the site yet. In "signup" mode it ends with the email field
 * and posts to /api/artist-alerts/subscribe; in "manage" mode it edits the
 * subscriber's follows through the token from their email.
 */
export default function ArtistAlertsForm(props: { artists: ArtistOption[]; mode: "signup" } | { artists: ArtistOption[]; mode: "manage"; token: string; followed: FollowedArtist[] }) {
  const { artists } = props;
  const followedIds = new Set(props.mode === "manage" ? props.followed.map((f) => f.artistId) : []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ArtistOption[]>([]);
  const [requests, setRequests] = useState<{ name: string; profileUrl: string }[]>([]);
  const [requestName, setRequestName] = useState("");
  const [requestUrl, setRequestUrl] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  const matches = useMemo(() => {
    const q = normalize(query);
    const pool = artists.filter((a) => !followedIds.has(a.id) && !selected.some((s) => s.id === a.id));
    // Search-only: no default list, so the page works however many artists exist.
    if (!q) return [];
    return pool.filter((a) => normalize(a.displayName).includes(q)).slice(0, 24);
    // followedIds is derived from props and stable for this render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artists, query, selected]);

  const nothingFound = query.trim().length >= 2 && matches.length === 0;
  const showRequest = requestOpen || nothingFound || requestName !== "";
  const chosenCount = selected.length + requests.length;

  function addRequest() {
    const name = requestName.trim() || query.trim();
    if (name.length < 2 || requests.length >= 10) return;
    setRequests([...requests, { name, profileUrl: requestUrl.trim() }]);
    setRequestName("");
    setRequestUrl("");
    setQuery("");
    setRequestOpen(false);
  }

  async function submit(path: string, body: Record<string, unknown>, successMessage: string) {
    setStatus("submitting");
    setMessage(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setStatus("error");
        setMessage(data?.error ?? "Something went wrong. Please try again in a moment.");
        return false;
      }
      setStatus("success");
      setMessage(successMessage);
      return true;
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again in a moment.");
      return false;
    }
  }

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chosenCount === 0) {
      setStatus("error");
      setMessage("Choose at least one artist.");
      return;
    }
    if (!isValidEmail(email)) {
      setStatus("error");
      setMessage("Enter a valid email address.");
      return;
    }
    await submit(
      "/api/artist-alerts/subscribe",
      { email, company, artistIds: selected.map((s) => s.id), requests },
      "Check your email. New here: confirm from the email, and your alerts start. Already getting Artist Alerts: the email has a link to add or remove artists — no new confirmation needed.",
    );
  }

  async function saveManage(change: { add?: string[]; remove?: string[]; requests?: { name: string; profileUrl: string }[] }) {
    if (props.mode !== "manage") return;
    const ok = await submit("/api/artist-alerts/manage", { token: props.token, add: [], remove: [], requests: [], ...change }, "Saved.");
    if (ok) window.location.reload();
  }

  if (props.mode === "signup" && status === "success") {
    return (
      <p role="status" className="mt-6 text-sm text-text-secondary">
        {message}
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {props.mode === "manage" && (
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Your artists</h2>
          {props.followed.length === 0 ? (
            <p className="mt-2 text-sm text-text-secondary">You are not following any artists.</p>
          ) : (
            <ul className="mt-2">
              {props.followed.map((f) => (
                <li key={f.artistId} className="flex items-center justify-between gap-3 border-b border-border py-2">
                  <span className="text-sm text-text-primary">
                    {f.displayName} <span className="text-xs text-text-tertiary">· {STATE_LABEL[f.state]}</span>
                  </span>
                  <button type="button" className={QUIET_BUTTON} onClick={() => saveManage({ remove: [f.artistId] })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <label htmlFor="artist-search" className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
          {props.mode === "manage" ? "Add artists" : "Find artists"}
        </label>
        <input
          id="artist-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artists"
          autoComplete="off"
          className={`${INPUT} mt-2`}
        />
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {!query && <p className="text-xs text-text-tertiary">Type an artist&rsquo;s name to find them.</p>}
          {!showRequest && (
            <button type="button" onClick={() => setRequestOpen(true)} className="text-xs text-text-secondary underline hover:text-text-primary">
              Artist not on Electronic CPH yet? Request them
            </button>
          )}
        </div>
        {showRequest && (
          <div className="mt-3 rounded border border-border p-3">
            <p className="text-sm text-text-secondary">
              Can&rsquo;t find the artist? Ask us to add them. A SoundCloud or Spotify link helps us find the right one.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input aria-label="Artist name" value={requestName || query} onChange={(e) => setRequestName(e.target.value)} className={INPUT} maxLength={80} />
              <input aria-label="SoundCloud or Spotify link (optional)" value={requestUrl} onChange={(e) => setRequestUrl(e.target.value)} placeholder="SoundCloud or Spotify link (optional)" className={INPUT} maxLength={300} />
              <button
                type="button"
                className={BUTTON}
                onClick={() => (props.mode === "manage" ? saveManage({ requests: [{ name: requestName.trim() || query.trim(), profileUrl: requestUrl.trim() }] }) : addRequest())}
              >
                Request
              </button>
            </div>
            <p className="mt-2 text-xs text-text-tertiary">Requested artists only start sending alerts once we have confirmed who they are.</p>
          </div>
        )}
        <ul className="mt-2">
          {matches.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 border-b border-border py-2">
              <span className="min-w-0 text-sm text-text-primary">
                {a.displayName}
                {a.disambiguation && <span className="text-text-tertiary"> ({a.disambiguation})</span>}
                {a.upcomingEvents > 0 && (
                  <Link href={`/?q=${encodeURIComponent(a.displayName)}`} className="ml-2 text-xs text-text-tertiary underline hover:text-text-secondary">
                    {a.upcomingEvents} upcoming
                  </Link>
                )}
              </span>
              <button
                type="button"
                className={QUIET_BUTTON}
                onClick={() => (props.mode === "manage" ? saveManage({ add: [a.id] }) : setSelected([...selected, a]))}
              >
                Follow
              </button>
            </li>
          ))}
        </ul>

      </section>

      {props.mode === "signup" && (
        <form onSubmit={handleSignup} noValidate className="space-y-3">
          {chosenCount > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Chosen artists">
              {selected.map((a) => (
                <li key={a.id}>
                  <button type="button" className={QUIET_BUTTON} onClick={() => setSelected(selected.filter((s) => s.id !== a.id))} aria-label={`Remove ${a.displayName}`}>
                    {a.displayName} ×
                  </button>
                </li>
              ))}
              {requests.map((r, i) => (
                <li key={`r${i}`}>
                  <button type="button" className={QUIET_BUTTON} onClick={() => setRequests(requests.filter((_, j) => j !== i))} aria-label={`Remove request ${r.name}`}>
                    {r.name} (requested) ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              className={`${INPUT} sm:w-72`}
            />
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute h-0 w-0 opacity-0" />
            <button type="submit" disabled={status === "submitting"} className={BUTTON}>
              {status === "submitting" ? "…" : `Get alerts${chosenCount ? ` (${chosenCount})` : ""}`}
            </button>
          </div>
          <p className="text-xs text-text-tertiary">
            We email you when a new event with one of your artists is listed — nothing else. Confirm by email first; unsubscribe any time from
            the link in every email.
          </p>
        </form>
      )}

      {message && status !== "success" && (
        <p role="alert" className="text-xs text-status-bad">
          {message}
        </p>
      )}
    </div>
  );
}
