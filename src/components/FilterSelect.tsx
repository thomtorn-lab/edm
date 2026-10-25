import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";

// Shared shell for the public filter <select>s (EventExplorer's desktop pills
// and mobile sheet, FestivalExplorer).
//
// Arrow: the native one can't be moved with padding (Chromium, Android and
// iOS each draw it at a fixed spot right at the border), so it's hidden
// (appearance-none) and replaced by a chevron of the same size, inset 12px
// further from the right edge than the native one.
//
// Value: the <select> keeps its own padding, so content-sized selects keep
// exactly the width they had (sized by their longest option), but its native
// text is made invisible and the selected label is drawn on top instead,
// ending 12px before the chevron and truncated with an ellipsis only when it
// doesn't fit. Doing the truncation in a plain span rather than relying on
// `text-overflow` on the <select> itself behaves identically in every engine.
// The default (first) option is never truncated: an invisible copy of it, laid
// out with the overlay's padding, shares the select's grid cell, so the
// control widens just enough for it where the select's own width is short
// (today only Festivals' "All months"); everywhere else the select is wider
// and nothing changes.
// The <select> stays the real, focusable control, so assistive tech still
// announces its label and the full selected value; `title` exposes the full
// value to mouse users when the visible one is cut short.
//
// Props:
// - textClassName: typography + left padding, shared by the select and the
//   overlay so the visible value sits exactly where the native text did.
// - className: the select's box (border, background, height, right padding,
//   focus/hover hooks). Right padding is the old px-N + 16px and left padding
//   (in textClassName) the old px-N + 4px: the native control's reserved
//   arrow width and built-in text indent, which appearance-none drops.
// - valueClassName: text color of the overlay and chevron, mirroring the
//   select's own color states (`peer-hover:` for hover).
export function FilterSelect({
  className = "",
  textClassName = "",
  valueClassName = "",
  wrapperClassName = "",
  children,
  ...props
}: ComponentProps<"select"> & {
  textClassName?: string;
  valueClassName?: string;
  wrapperClassName?: string;
}) {
  const options = optionsOf(children);
  const wanted = props.value ?? props.defaultValue;
  const label =
    (options.find((o) => o.value === String(wanted)) ?? options[0])?.label ?? "";
  return (
    <span className={`relative inline-grid ${wrapperClassName}`}>
      <select
        {...props}
        title={label}
        className={`peer col-start-1 row-start-1 appearance-none [-webkit-text-fill-color:transparent] [&_*]:[-webkit-text-fill-color:currentColor] ${textClassName} ${className}`}
      >
        {children}
      </select>
      {/* border-transparent mirrors the select's 1px border so the padding
          in textClassName lands on the same x. pr-9 = chevron inset (16px)
          + chevron (9px) + 12px gap - 1px border. The sizer below uses the
          same box, so the default label always fits the overlay. */}
      <span
        aria-hidden="true"
        className={`invisible col-start-1 row-start-1 h-0 overflow-hidden whitespace-nowrap border-x border-transparent pr-9 ${textClassName}`}
      >
        {options[0]?.label}
      </span>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 flex items-center border border-transparent pr-9 ${textClassName} ${valueClassName}`}
      >
        <span data-select-value className="min-w-0 truncate">{label}</span>
      </span>
      <svg
        viewBox="0 0 9 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={`pointer-events-none absolute right-4 top-1/2 h-1.5 w-[9px] -translate-y-1/2 ${valueClassName}`}
        aria-hidden="true"
      >
        <path d="M1 1l3.5 3.5L8 1" strokeLinecap="square" />
      </svg>
    </span>
  );
}

// Every <option> (fragments and <optgroup>s included), read from the children
// so labels are available during SSR too. A <select> with no matching value
// shows its first option, hence the fallback above.
function optionsOf(children: ReactNode): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const walk = (nodes: ReactNode) =>
    Children.forEach(nodes, (node) => {
      if (!isValidElement<{ value?: unknown; children?: ReactNode }>(node)) return;
      if (node.type === "option") {
        const label = textOf(node.props.children);
        options.push({ value: String(node.props.value ?? label), label });
      } else {
        walk(node.props.children);
      }
    });
  walk(children);
  return options;
}

function textOf(nodes: ReactNode): string {
  let text = "";
  Children.forEach(nodes, (node) => {
    if (typeof node === "string" || typeof node === "number") text += node;
  });
  return text;
}
