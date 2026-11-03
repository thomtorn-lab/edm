import Link from "next/link";
import { artistAlertsMode } from "@/lib/artistAlerts/config";

const NAV = [
  { href: "/", label: "Events" },
  { href: "/venues", label: "Venues" },
  { href: "/festivals", label: "Festivals" },
  { href: "/about", label: "About" },
];

/** "Artists" joins the navigation only once Artist Alerts is live (ARTIST_ALERTS_MODE=live). */
const ARTISTS = { href: "/artists", label: "Artists" };

export default function Header() {
  const nav = artistAlertsMode() === "live" ? [NAV[0], NAV[1], ARTISTS, ...NAV.slice(2)] : NAV;
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2 shrink-0">
          <span className="font-display text-base font-bold uppercase tracking-tight text-text-primary sm:text-xl">
            Electronic CPH
          </span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.1em] text-text-secondary sm:gap-6 sm:text-xs sm:tracking-[0.14em]">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-text-primary"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
