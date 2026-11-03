import type { Metadata } from "next";
import Link from "next/link";
import ArtistAlertsForm from "@/components/ArtistAlertsForm";
import { getManageView } from "@/db/artistAlerts";
import { listFollowableArtists } from "@/db/artistAppearances";
import { isWellFormedToken } from "@/lib/artistAlerts/tokens";

export const metadata: Metadata = { title: "Your artist alerts", robots: { index: false } };
export const revalidate = 0;

/** Token-bearing page: works in every mode, so links in sent emails keep working (and unsubscribing always does). */
export default async function ManageArtistAlertsPage({ searchParams }: { searchParams: Promise<{ token?: string; confirmed?: string }> }) {
  const { token, confirmed } = await searchParams;
  const view = isWellFormedToken(token) ? await getManageView(token) : null;
  if (!token || !view) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center sm:px-6">
        <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-text-primary">Link not valid</h1>
        <p className="mt-3 text-sm text-text-secondary">This link is invalid, or the subscription no longer exists.</p>
        <p className="mt-6 text-xs text-text-tertiary">
          <Link href="/" className="underline hover:text-text-secondary">Back to the calendar</Link>
        </p>
      </div>
    );
  }
  const artists = await listFollowableArtists();
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-accent sm:text-4xl">Your artist alerts</h1>
      <p className="mt-2 text-sm text-text-secondary">Alerts go to {view.email}.</p>
      {confirmed && (
        <p role="status" className="mt-3 text-sm text-text-secondary">
          Confirmed. You&rsquo;ll get an email when a new event with one of your artists is listed.
        </p>
      )}
      <ArtistAlertsForm mode="manage" token={token} artists={artists} followed={view.follows} />
      <form method="POST" action={`/api/artist-alerts/unsubscribe?token=${token}`} className="mt-10 border-t border-border pt-6">
        <input type="hidden" name="from" value="manage" />
        <button type="submit" className="text-xs uppercase tracking-wide text-text-tertiary underline hover:text-text-secondary">
          Unsubscribe and delete my data
        </button>
      </form>
    </div>
  );
}
