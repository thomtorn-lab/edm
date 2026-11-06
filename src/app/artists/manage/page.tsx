import type { Metadata } from "next";
import ArtistAlertsForm from "@/components/ArtistAlertsForm";
import ManageLinkForm from "@/components/ManageLinkForm";
import { getManageView } from "@/db/artistAlerts";
import { listFollowableArtists } from "@/db/artistAppearances";
import { artistAlertsMode, subscriptionsEnabled } from "@/lib/artistAlerts/config";
import { decodeRequestPicks } from "@/lib/artistAlerts/emailContent";
import { artistIdentityKey } from "@/lib/artistIdentity/lineupIdentity";
import { parseRequests } from "@/lib/artistAlerts/requestParsing";
import { isWellFormedToken } from "@/lib/artistAlerts/tokens";

export const metadata: Metadata = { title: "Manage your artist alerts", robots: { index: false } };
export const revalidate = 0;

const H1 = "font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-accent sm:text-4xl";

/**
 * With a token (the link in every email): the subscriber's artists. It works
 * in every mode, so links in sent emails keep working (and unsubscribing
 * always does). `add`/`req` carry picks made on the public form by someone
 * already subscribed; they are only offered here, and added on a button press.
 * Without a token: the "Manage Artist Alerts" form that emails the link.
 */
export default async function ManageArtistAlertsPage({ searchParams }: { searchParams: Promise<{ token?: string; confirmed?: string; add?: string; req?: string }> }) {
  const { token, confirmed, add, req } = await searchParams;
  const view = isWellFormedToken(token) ? await getManageView(token) : null;
  if (!token || !view) {
    if (!subscriptionsEnabled(artistAlertsMode())) {
      return (
        <div className="mx-auto max-w-md px-4 py-12 text-center sm:px-6">
          <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-text-primary">Link not valid</h1>
          <p className="mt-3 text-sm text-text-secondary">This link is invalid, or the subscription no longer exists.</p>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className={H1}>Manage your artist alerts</h1>
        {token && <p className="mt-3 text-sm text-text-secondary">This link no longer works. You can get a new one below.</p>}
        <p className="mt-2 max-w-xl text-sm text-text-secondary">Enter your email address and we&rsquo;ll send you a link to manage the artists you follow.</p>
        <ManageLinkForm />
      </div>
    );
  }
  const artists = await listFollowableArtists();
  const followedIds = new Set(view.follows.map((f) => f.artistId));
  const followedNames = new Set(view.follows.map((f) => artistIdentityKey(f.displayName)));
  const addIds = new Set((add ?? "").split(",").slice(0, 50));
  const picks = {
    artists: artists.filter((a) => addIds.has(a.id) && !followedIds.has(a.id)),
    requests: parseRequests(decodeRequestPicks(req)).filter((r) => !followedNames.has(artistIdentityKey(r.name))),
  };
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className={H1}>Your artist alerts</h1>
      <p className="mt-2 text-sm text-text-secondary">Alerts go to {view.email}.</p>
      {confirmed && (
        <p role="status" className="mt-3 text-sm text-text-secondary">
          You&rsquo;re all set. We&rsquo;ll email you when a new event with one of your artists is listed.
        </p>
      )}
      <ArtistAlertsForm mode="manage" token={token} artists={artists} followed={view.follows} picks={picks} />
      <form method="POST" action={`/api/artist-alerts/unsubscribe?token=${token}`} className="mt-10 border-t border-border pt-6">
        <input type="hidden" name="from" value="manage" />
        <button type="submit" className="text-xs uppercase tracking-wide text-text-tertiary underline hover:text-text-secondary">
          Unsubscribe and delete my data
        </button>
      </form>
    </div>
  );
}
