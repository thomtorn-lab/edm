import type { Metadata } from "next";
import ArtistReview from "@/components/admin/ArtistReview";
import { listRequestedArtists } from "@/db/artistAlerts";
import { listReviewAppearances } from "@/db/artistAppearances";

export const metadata: Metadata = { title: "Artist review", robots: { index: false } };
export const revalidate = 0;

/** Artist Alerts review queue (behind /admin Basic Auth). */
export default async function AdminArtistsPage() {
  const [appearances, requests] = await Promise.all([listReviewAppearances(), listRequestedArtists()]);
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-text-primary">Artist review</h1>
      <div className="mt-6">
        <ArtistReview
          appearances={appearances.map((a) => ({ ...a, start: a.startDatetime.toISOString() }))}
          requests={requests.map((r) => ({ id: r.id, displayName: r.displayName, profileUrl: r.profileUrl, followers: Number(r.followers) }))}
        />
      </div>
    </div>
  );
}
