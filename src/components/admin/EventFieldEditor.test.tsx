// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { EventFieldEditorTop } from "./EventFieldEditor";

afterEach(cleanup);

describe("EventFieldEditorTop date & time fields", () => {
  // Without a max, Chrome's year segment accepts six digits and never
  // advances to the hour, so typing a whole date and time in one go puts the
  // time into the year. The four-digit cap is what keeps one-go typing working.
  it("caps the year at four digits on both the start and end inputs", () => {
    const noop = () => {};
    const { container } = render(
      <EventFieldEditorTop
        idPrefix="t"
        title=""
        onTitleChange={noop}
        description=""
        onDescriptionChange={noop}
        startLocal=""
        onStartLocalChange={noop}
        endLocal=""
        onEndLocalChange={noop}
      />,
    );
    const inputs = container.querySelectorAll('input[type="datetime-local"]');
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input.getAttribute("max")).toBe("9999-12-31T23:59");
  });
});
