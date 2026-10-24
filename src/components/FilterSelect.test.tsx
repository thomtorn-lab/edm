// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FilterSelect } from "./FilterSelect";

afterEach(cleanup);

const LONG = "Ambient / Experimental";

function Controlled({ initial = "all" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="genre">Genre</label>
      <FilterSelect id="genre" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="all">All genres</option>
        <optgroup label="More">
          <option value="ambient">{LONG}</option>
        </optgroup>
      </FilterSelect>
    </>
  );
}

const visibleValue = (container: HTMLElement) =>
  container.querySelector("[data-select-value]") as HTMLElement;

describe("FilterSelect", () => {
  it("draws the selected option's label (found through fragments/optgroups) and follows changes", () => {
    const { container } = render(<Controlled />);
    expect(visibleValue(container).textContent).toBe("All genres");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ambient" } });
    expect(visibleValue(container).textContent).toBe(LONG);
  });

  it("falls back to the first option when the value matches none, like a native select", () => {
    const { container } = render(<Controlled initial="nope" />);
    expect(visibleValue(container).textContent).toBe("All genres");
  });

  it("keeps the full value accessible: the select stays the labelled control with the full selected value, the visible copy is hidden from assistive tech, and title carries the full text", () => {
    const { container } = render(<Controlled initial="ambient" />);
    const select = screen.getByRole("combobox", { name: "Genre" }) as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe(LONG);
    expect(select.title).toBe(LONG);
    expect(visibleValue(container).closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("truncates only via the overlay span (ellipsis when it doesn't fit) and keeps the 12px gap before the chevron (pr-9)", () => {
    const { container } = render(<Controlled initial="ambient" />);
    const value = visibleValue(container);
    expect(value.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
    expect((value.parentElement as HTMLElement).className.split(/\s+/)).toContain("pr-9");
  });
});
