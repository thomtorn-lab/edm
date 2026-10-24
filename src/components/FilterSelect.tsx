import type { ComponentProps } from "react";

// Shared shell for the public filter <select>s (EventExplorer's desktop pills
// and mobile sheet, FestivalExplorer). The native arrow can't be moved with
// padding — Chromium, Android and iOS each draw it at a fixed spot right at
// the border — so it's hidden (appearance-none) and replaced by a chevron of
// the same size, inset 12px further from the right edge than the native one.
// appearance-none also drops what the native control added around the text,
// so callers convert their old px-N to pl = N + 4px (Chromium's built-in text
// indent) and pr = N + 16px (the width the native arrow reserved, minus that
// 4px), so text position and content-sized widths stay exactly as before, and
// give an explicit height (Chromium adds 1-6px to a native select's height).
// chevronClassName sets the chevron's color, mirroring the select's text
// color states (`peer-hover:` for hover).
export function FilterSelect({
  className = "",
  wrapperClassName = "",
  chevronClassName = "",
  ...props
}: ComponentProps<"select"> & { wrapperClassName?: string; chevronClassName?: string }) {
  return (
    <span className={`relative inline-flex ${wrapperClassName}`}>
      <select {...props} className={`peer appearance-none ${className}`} />
      <svg
        viewBox="0 0 9 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={`pointer-events-none absolute right-4 top-1/2 h-1.5 w-[9px] -translate-y-1/2 ${chevronClassName}`}
        aria-hidden="true"
      >
        <path d="M1 1l3.5 3.5L8 1" strokeLinecap="square" />
      </svg>
    </span>
  );
}
