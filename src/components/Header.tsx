import Link from "next/link";

const NAV = [
  { href: "/", label: "Events" },
  { href: "/festivals", label: "Festivals" },
  { href: "/venues", label: "Venues" },
  { href: "/about", label: "About" },
];

export default function Header() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2 shrink-0">
          <span className="font-display text-base font-bold uppercase tracking-tight text-text-primary sm:text-xl">
            Nattefrekvens
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.18em] text-text-tertiary sm:inline">
            CPH
          </span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.1em] text-text-secondary sm:gap-6 sm:text-xs sm:tracking-[0.14em]">
          {NAV.map((item) => (
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
