import type { Metadata } from "next";
import Link from "next/link";
import { ARTIST_ALERTS_CONSENT_PURPOSE } from "@/lib/artistAlerts/config";

export const metadata: Metadata = { title: "Confirm artist alerts", robots: { index: false } };
export const revalidate = 0;

/** GET-safe: loading performs no write. Only the button (POST) confirms, so link scanners can't. */
export default async function ConfirmArtistAlertsPage({ searchParams }: { searchParams: Promise<{ token?: string; invalid?: string }> }) {
  const { token, invalid } = await searchParams;
  if (!token || invalid) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center sm:px-6">
        <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-text-primary">Link not valid</h1>
        <p className="mt-3 text-sm text-text-secondary">This confirmation link is invalid or has expired. You can sign up again on the Artists page.</p>
        <p className="mt-6 text-xs text-text-tertiary">
          <Link href="/artists" className="underline hover:text-text-secondary">Artists</Link>
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md px-4 py-12 text-center sm:px-6">
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-text-primary">Confirm your artist alerts</h1>
      <p className="mt-3 text-sm text-text-secondary">{ARTIST_ALERTS_CONSENT_PURPOSE}</p>
      <form method="POST" action="/api/artist-alerts/confirm" className="mt-6">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="rounded border border-accent bg-accent/10 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-accent-strong hover:bg-accent/20">
          Confirm
        </button>
      </form>
    </div>
  );
}
