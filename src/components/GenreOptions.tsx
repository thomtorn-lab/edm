import type { ReactNode } from "react";
import { genresByVisualGroup, type GenreDef } from "@/lib/taxonomy";

/**
 * The selectable genres as <optgroup>s under their visual headings, in the
 * taxonomy's display order — shared by the admin genre selects and the
 * public genre filter so both always list the same genres in the same
 * order. Headings are presentation only (an <optgroup> is never a value).
 * `include` narrows the list (e.g. valid secondary genres); a group left
 * empty is omitted.
 *
 * A plain function returning <optgroup>/<option> elements rather than a
 * component: FilterSelect reads its options straight from its children
 * (to draw the selected label, also during SSR), and it can only see
 * native <option> elements, not inside a custom component.
 */
export function renderGenreOptions(include?: (genre: GenreDef) => boolean): ReactNode {
  return genresByVisualGroup().map(({ group, genres }) => {
    const shown = include ? genres.filter(include) : genres;
    if (shown.length === 0) return null;
    return (
      <optgroup key={group.slug} label={group.label}>
        {shown.map((g) => (
          <option key={g.slug} value={g.slug}>
            {g.label}
          </option>
        ))}
      </optgroup>
    );
  });
}
