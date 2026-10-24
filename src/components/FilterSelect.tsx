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
  const label = selectedLabel(children, props.value ?? props.defaultValue);
  return (
    <span className={`relative inline-flex ${wrapperClassName}`}>
      <select
        {...props}
        title={label}
        className={`peer appearance-none [-webkit-text-fill-color:transparent] [&_*]:[-webkit-text-fill-color:currentColor] ${textClassName} ${className}`}
      >
        {children}
      </select>
      {/* border-transparent mirrors the select's 1px border so the padding
          in textClassName lands on the same x. pr-9 = chevron inset (16px)
          + chevron (9px) + 12px gap - 1px border. */}
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

// Label of the <option> matching `value`, found by walking the children
// (fragments and <optgroup>s included) so it's available during SSR too.
// Falls back to the first option, as a <select> does with no match.
function selectedLabel(children: ReactNode, value: unknown): string {
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
  const wanted = value === undefined ? undefined : String(value);
  return (options.find((o) => o.value === wanted) ?? options[0])?.label ?? "";
}

function textOf(nodes: ReactNode): string {
  let text = "";
  Children.forEach(nodes, (node) => {
    if (typeof node === "string" || typeof node === "number") text += node;
  });
  return text;
}
