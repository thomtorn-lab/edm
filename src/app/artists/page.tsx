import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ArtistAlertsForm from "@/components/ArtistAlertsForm";
import { listFollowableArtists } from "@/db/artistAppearances";
import { artistAlertsMode, subscriptionsEnabled } from "@/lib/artistAlerts/config";

export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Artists",
    description: "Follow your favourite artists and get an email when they play in Copenhagen.",
    alternates: { canonical: "/artists" },
    robots: artistAlertsMode() === "live" ? undefined : { index: false },
  };
}

export default async function ArtistsPage({ searchParams }: { searchParams: Promise<{ unsubscribed?: string }> }) {
  if (!subscriptionsEnabled(artistAlertsMode())) notFound();
  const { unsubscribed } = await searchParams;
  const artists = await listFollowableArtists();
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-accent sm:text-4xl">Artists</h1>
      <p className="mt-2 max-w-xl text-sm text-text-secondary">
        Follow the artists you care about. When a new event with one of them is listed on Electronic CPH, we send you one short email.
      </p>
      {unsubscribed && (
        <p role="status" className="mt-4 text-sm text-text-secondary">
          You&rsquo;re unsubscribed and your data is deleted.
        </p>
      )}
      <ArtistAlertsForm mode="signup" artists={artists} />
    </div>
  );
}
