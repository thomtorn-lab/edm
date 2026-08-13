import type { Metadata } from "next";
import { FESTIVALS } from "@/lib/data/festivals";
import FestivalExplorer from "@/components/FestivalExplorer";

export const metadata: Metadata = {
  title: "Festivals",
  description: "A curated guide to the European electronic music festivals most worth knowing about, from Tomorrowland to Dekmantel.",
  alternates: { canonical: "/festivals" },
};

export default function FestivalsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-tight text-text-primary sm:text-4xl">
        Festivals
      </h1>
      <p className="mt-2 max-w-xl text-sm text-text-secondary">
        A curated guide to the European electronic music festivals worth knowing about — not a full listing, just the ones that matter.
      </p>
      <div className="mt-6">
        <FestivalExplorer festivals={FESTIVALS} />
      </div>
    </div>
  );
}
